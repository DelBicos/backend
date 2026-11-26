jest.mock("../../config/database");
jest.mock("../../services/notification/notification.service", () => {
  // Mantem a regra real de "mesmo usuario"; so o acesso a dados e mockado.
  const actual = jest.requireActual(
    "../../services/notification/notification.service",
  );
  return {
    assertSameUser: actual.assertSameUser,
    listNotifications: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    savePushToken: jest.fn(),
  };
});
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as NotificationService from "../../services/notification/notification.service";
import { HttpError } from "../../errors/HttpError";
import {
  getNotificationsByUser as getNotificationsHandler,
  markAllNotificationsAsRead as markAllHandler,
  markNotificationAsRead as markOneHandler,
  saveExpoPushToken as saveTokenHandler,
} from "../notification.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const service = NotificationService as unknown as Record<string, jest.Mock>;
const getNotificationsByUser = settled(getNotificationsHandler);
const markNotificationAsRead = settled(markOneHandler);
const markAllNotificationsAsRead = settled(markAllHandler);
const saveExpoPushToken = settled(saveTokenHandler);

beforeEach(() => jest.clearAllMocks());

describe("notification.controller", () => {
  it("exige usuario autenticado (401)", async () => {
    const res = mockRes();
    await getNotificationsByUser(mockReq({ params: { userId: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(service.listNotifications).not.toHaveBeenCalled();
  });

  it("proibe ler notificacoes de outro usuario (403)", async () => {
    const res = mockRes();
    await getNotificationsByUser(
      mockReq({ user: { id: 1 }, params: { userId: "2" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(service.listNotifications).not.toHaveBeenCalled();
  });

  it("lista as notificacoes do proprio usuario", async () => {
    service.listNotifications.mockResolvedValue([{ id: 5 }]);
    const res = mockRes();
    await getNotificationsByUser(
      mockReq({ user: { id: 1 }, params: { userId: "1" } }),
      res,
    );
    expect(service.listNotifications).toHaveBeenCalledWith(1);
    expect(res.json).toHaveBeenCalledWith([{ id: 5 }]);
  });

  it("marca uma notificacao como lida e repassa o 404 do servico", async () => {
    service.markAsRead.mockResolvedValueOnce({ id: 5, read: true });
    const res = mockRes();
    await markNotificationAsRead(
      mockReq({
        user: { id: 1 },
        params: { userId: "1", notificationId: "5" },
      }),
      res,
    );
    expect(service.markAsRead).toHaveBeenCalledWith(1, "5");
    expect(res.json).toHaveBeenCalledWith({ id: 5, read: true });

    service.markAsRead.mockRejectedValueOnce(
      HttpError.notFound("Notificação não encontrada"),
    );
    const missing = mockRes();
    await markNotificationAsRead(
      mockReq({
        user: { id: 1 },
        params: { userId: "1", notificationId: "9" },
      }),
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);
    expect(missing.json).toHaveBeenCalledWith({
      error: "Notificação não encontrada",
    });
  });

  it("marca todas como lidas e informa quantas mudaram", async () => {
    service.markAllAsRead.mockResolvedValue(3);
    const res = mockRes();
    await markAllNotificationsAsRead(
      mockReq({ user: { id: 1 }, params: { userId: "1" } }),
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      message: "3 notifications marked as read.",
      updatedCount: 3,
    });
  });

  it("salva o token de push no usuario do JWT, ignorando o userId do corpo", async () => {
    service.savePushToken.mockResolvedValue(undefined);
    const res = mockRes();
    await saveExpoPushToken(
      mockReq({
        user: { id: 1 },
        body: { userId: 99, token: "ExponentPushToken[abc]" },
      }),
      res,
    );
    expect(service.savePushToken).toHaveBeenCalledWith(
      1,
      "ExponentPushToken[abc]",
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Expo Push Token saved successfully.",
    });
  });

  it("repassa o 400 do servico para token invalido", async () => {
    service.savePushToken.mockRejectedValue(
      HttpError.badRequest("Invalid Expo Push Token format."),
    );
    const res = mockRes();
    await saveExpoPushToken(
      mockReq({ user: { id: 1 }, body: { token: "nope" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid Expo Push Token format.",
    });
  });
});

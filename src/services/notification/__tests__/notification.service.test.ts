import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Notification");
jest.mock("../../../models/UserToken");
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

const mockSendPush = jest.fn();
jest.mock("expo-server-sdk", () => {
  const actual = jest.requireActual("expo-server-sdk");
  class Expo {
    static isExpoPushToken = actual.Expo.isExpoPushToken;
    sendPushNotificationsAsync = (...args: unknown[]) => mockSendPush(...args);
  }
  return { ...actual, Expo };
});

import { NotificationModel } from "../../../models/Notification";
import { UserTokenModel } from "../../../models/UserToken";
import logger from "../../../utils/logger";
import * as service from "../notification.service";

const mocked = (fn: unknown) => fn as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("notification.service", () => {
  it("proibe acessar notificacoes de outro usuario", () => {
    expect(() => service.assertSameUser(1, "2")).toThrow(HttpError);
    expect(() => service.assertSameUser(1, "1")).not.toThrow();
    expect(() => service.assertSameUser(1, undefined)).not.toThrow();
  });

  it("lista apenas as notificacoes do usuario", async () => {
    mocked(NotificationModel.findAll).mockResolvedValue([]);
    await service.listNotifications(7);
    expect(mocked(NotificationModel.findAll).mock.calls[0][0].where).toEqual({ user_id: 7 });
  });

  it("nao marca como lida notificacao de outro usuario", async () => {
    mocked(NotificationModel.findByPk).mockResolvedValue({ id: 3, user_id: 99 });
    await expect(service.markAsRead(7, "3")).rejects.toMatchObject({ status: 404 });
  });

  it("marca como lida a propria notificacao", async () => {
    const notification = { id: 3, user_id: 7, is_read: false, save: jest.fn() };
    mocked(NotificationModel.findByPk).mockResolvedValue(notification);
    await service.markAsRead(7, "3");
    expect(notification.is_read).toBe(true);
    expect(notification.save).toHaveBeenCalled();
  });

  it("valida o formato do token de push e associa ao usuario do JWT", async () => {
    await expect(service.savePushToken(7, "token-invalido")).rejects.toMatchObject({
      status: 400,
    });
    await service.savePushToken(7, "ExponentPushToken[abc123]");
    expect(UserTokenModel.upsert).toHaveBeenCalledWith({
      user_id: 7,
      token: "ExponentPushToken[abc123]",
    });
  });

  it("nao busca notificacao com id invalido", async () => {
    await expect(service.markAsRead(7, "abc")).rejects.toMatchObject({ status: 404 });
    expect(NotificationModel.findByPk).not.toHaveBeenCalled();
  });

  it("nao salva de novo notificacao ja lida", async () => {
    const notification = { id: 3, user_id: 7, is_read: true, save: jest.fn() };
    mocked(NotificationModel.findByPk).mockResolvedValue(notification);
    await expect(service.markAsRead(7, 3)).resolves.toBe(notification);
    expect(notification.save).not.toHaveBeenCalled();
  });

  it("marca todas as notificacoes nao lidas do usuario e devolve o total", async () => {
    mocked(NotificationModel.update).mockResolvedValue([4]);
    await expect(service.markAllAsRead(7)).resolves.toBe(4);
    expect(NotificationModel.update).toHaveBeenCalledWith(
      { is_read: true },
      { where: { user_id: 7, is_read: false } },
    );
  });

  it("rejeita token de push que nao e texto", async () => {
    await expect(service.savePushToken(7, 123)).rejects.toMatchObject({ status: 400 });
    expect(UserTokenModel.upsert).not.toHaveBeenCalled();
  });

  describe("sendPushNotification", () => {
    it("nao envia push quando o usuario nao tem token", async () => {
      mocked(UserTokenModel.findOne).mockResolvedValue(null);
      await service.sendPushNotification(7, "Titulo", "Mensagem", 1);
      expect(mockSendPush).not.toHaveBeenCalled();
    });

    it("nao envia push quando o token salvo e invalido", async () => {
      mocked(UserTokenModel.findOne).mockResolvedValue({ token: "invalido" });
      await service.sendPushNotification(7, "Titulo", "Mensagem", 1);
      expect(mockSendPush).not.toHaveBeenCalled();
    });

    it("envia push para o dispositivo do usuario", async () => {
      mocked(UserTokenModel.findOne).mockResolvedValue({
        token: "ExponentPushToken[abc123]",
      });
      mockSendPush.mockResolvedValue([]);

      await service.sendPushNotification(7, "Titulo", "Mensagem", 9);

      expect(UserTokenModel.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
      expect(mockSendPush).toHaveBeenCalledWith([
        {
          to: "ExponentPushToken[abc123]",
          sound: "default",
          title: "Titulo",
          body: "Mensagem",
          data: {
            id: 9,
            title: "Titulo",
            message: "Mensagem",
            createdAt: expect.any(String),
          },
        },
      ]);
    });

    it("registra aviso sem lancar quando o envio falha", async () => {
      mocked(UserTokenModel.findOne).mockResolvedValue({
        token: "ExponentPushToken[abc123]",
      });
      mockSendPush.mockRejectedValue(new Error("expo fora"));

      await expect(
        service.sendPushNotification(7, "Titulo", "Mensagem", 9),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith("Falha ao enviar notificação push", {
        userId: 7,
        reason: "expo fora",
      });
    });
  });
});

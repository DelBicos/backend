jest.mock("expo-server-sdk", () => {
  const Expo = jest.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([]),
  }));
  (Expo as unknown as { isExpoPushToken: (token: string) => boolean }).isExpoPushToken =
    (token: string) => token.startsWith("ExponentPushToken");
  return { Expo };
});

jest.mock("../../models/Notification", () => ({
  NotificationModel: {
    create: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock("../../models/UserToken", () => ({
  UserTokenModel: { upsert: jest.fn(), findOne: jest.fn() },
}));

import { NotificationModel } from "../../models/Notification";
import { UserTokenModel } from "../../models/UserToken";
import {
  createNotification,
  getNotificationsByUser,
  markNotificationAsRead,
  saveExpoPushToken,
} from "../notification.controller";
import { mockReq, mockRes } from "../../test/http";

describe("notification.controller", () => {
  it("returns 400 when the push token payload is incomplete", async () => {
    const res = mockRes();
    await saveExpoPushToken(mockReq({ body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "userId and token are required.",
    });
  });

  it("returns 400 for a token Expo would reject", async () => {
    const res = mockRes();
    await saveExpoPushToken(
      mockReq({ body: { userId: 1, token: "nope" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid Expo Push Token format.",
    });
  });

  it("returns 201 when the push token is stored", async () => {
    (UserTokenModel.upsert as jest.Mock).mockResolvedValue([{}, true]);
    const res = mockRes();
    await saveExpoPushToken(
      mockReq({
        body: { userId: 1, token: "ExponentPushToken[abc]" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 500 when saving the token fails", async () => {
    (UserTokenModel.upsert as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await saveExpoPushToken(
      mockReq({
        body: { userId: 1, token: "ExponentPushToken[abc]" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 201 for a created notification", async () => {
    (NotificationModel.create as jest.Mock).mockResolvedValue({
      id: 1,
      user_id: 4,
      title: "Oi",
      message: "msg",
    });
    (UserTokenModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await createNotification(
      mockReq({ body: { user_id: 4, title: "Oi", message: "msg" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when creating a notification throws", async () => {
    (NotificationModel.create as jest.Mock).mockRejectedValue(new Error("invalid"));
    const res = mockRes();
    await createNotification(mockReq({ body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid" });
  });

  it("returns 500 when listing notifications fails", async () => {
    (NotificationModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getNotificationsByUser(mockReq({ params: { userId: "4" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 404 when the notification to mark does not exist", async () => {
    (NotificationModel.update as jest.Mock).mockResolvedValue([0]);
    (NotificationModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await markNotificationAsRead(
      mockReq({ params: { userId: "4", notificationId: "9" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Notification not found." });
  });
});

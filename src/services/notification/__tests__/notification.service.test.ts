import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Notification");
jest.mock("../../../models/UserToken");

import { NotificationModel } from "../../../models/Notification";
import { UserTokenModel } from "../../../models/UserToken";
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
});

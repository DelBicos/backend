jest.mock("../../models/LoginLog", () => ({
  LoginLog: { create: jest.fn() },
}));

import { LoginLog } from "../../models/LoginLog";
import logger from "../../utils/logger";
import { saveLoginLog } from "../loginLog.service";

const create = LoginLog.create as jest.Mock;

describe("saveLoginLog", () => {
  const req = {
    ip: "203.0.113.8",
    headers: { "user-agent": "jest" },
  } as any;

  const data = { userId: 4, username: "ana@example.com", jwt: "token" };

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("persists a success log with ip and user agent", async () => {
    create.mockResolvedValue({ id: "log-1" });

    saveLoginLog(req, data);
    await new Promise((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "4",
        username: data.username,
        jwt: data.jwt,
        ip: "203.0.113.8",
        userAgent: "jest",
        status: "SUCCESS",
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("swallows persistence errors", async () => {
    create.mockRejectedValue(new Error("mongo down"));

    saveLoginLog(req, data);
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      "Falha ao salvar log de login no MongoDB",
      expect.objectContaining({ error: "mongo down", userId: 4 }),
    );
  });
});

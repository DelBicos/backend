jest.mock("../../models/LoginLog", () => ({
  LoginLog: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { Request } from "express";
import { LoginLog } from "../../models/LoginLog";
import logger from "../../utils/logger";
import { saveLoginLog, tokenFingerprint } from "../loginLog.service";

const create = LoginLog.create as jest.Mock;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const req = {
  ip: "203.0.113.8",
  headers: { "user-agent": "jest" },
} as unknown as Request;

const data = { userId: 4, username: "ana@example.com", jwt: "token" };

beforeEach(() => jest.clearAllMocks());

describe("tokenFingerprint", () => {
  it("gera uma impressao estavel que nao contem o token", () => {
    const fingerprint = tokenFingerprint("token");
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(fingerprint).toBe(tokenFingerprint("token"));
    expect(fingerprint).not.toContain("token");
  });
});

describe("saveLoginLog", () => {
  it("grava o login com ip, user agent e so a impressao do token", async () => {
    create.mockResolvedValue({ id: "log-1" });

    saveLoginLog(req, data);
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "4",
        username: data.username,
        jwt: tokenFingerprint(data.jwt),
        ip: "203.0.113.8",
        userAgent: "jest",
        status: "SUCCESS",
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("usa 'unknown' quando faltam ip e user agent", async () => {
    create.mockResolvedValue({});
    saveLoginLog({ headers: {} } as unknown as Request, data);
    await flush();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "unknown", userAgent: "unknown" }),
    );
  });

  it("engole falhas de gravacao e so registra no log", async () => {
    create.mockRejectedValue(new Error("mongo fora"));

    saveLoginLog(req, data);
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      "Falha ao salvar log de login no MongoDB",
      expect.objectContaining({ error: "mongo fora", userId: 4 }),
    );
  });
});

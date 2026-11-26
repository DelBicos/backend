import winston from "winston";
import logger, { logAuth, logDatabase, logError, logRequest } from "../logger";

describe("utils/logger", () => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    info = jest.spyOn(logger, "info").mockImplementation(() => logger);
    warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    error = jest.spyOn(logger, "error").mockImplementation(() => logger);
    debug = jest.spyOn(logger, "debug").mockImplementation(() => logger);
  });

  afterEach(() => jest.restoreAllMocks());

  it("logRequest escolhe o nivel pelo status", () => {
    logRequest("GET", "/a", 200, 5, 1);
    logRequest("GET", "/b", 404, 6);
    logRequest("GET", "/c", 500, 7, undefined, "boom");
    expect(info).toHaveBeenCalledWith("Request completed", expect.objectContaining({ duration: "5ms", userId: 1 }));
    expect(warn).toHaveBeenCalledWith("Request warning", expect.objectContaining({ statusCode: 404 }));
    expect(error).toHaveBeenCalledWith("Request error", expect.objectContaining({ error: "boom" }));
  });

  it("logAuth registra sucesso como info e falha como aviso", () => {
    logAuth("login", 1, "a@b.com");
    logAuth("login", 2, "c@d.com", false, "senha");
    expect(info).toHaveBeenCalledWith("Auth: login", expect.objectContaining({ success: true }));
    expect(warn).toHaveBeenCalledWith("Auth failed: login", expect.objectContaining({ reason: "senha" }));
  });

  it("logDatabase usa debug sem erro e error com erro", () => {
    logDatabase("insert", "users", 3);
    logDatabase("update", "users", 3, "falhou");
    expect(debug).toHaveBeenCalledWith("DB: insert on users", expect.objectContaining({ recordId: 3 }));
    expect(error).toHaveBeenCalledWith("DB error: update on users", expect.objectContaining({ error: "falhou" }));
  });

  it("logError aceita Error e valores quaisquer, com contexto", () => {
    const failure = new Error("quebrou");
    logError("Falha A", failure, { userId: 9 });
    logError("Falha B", "texto");
    expect(error).toHaveBeenCalledWith(
      "Falha A",
      expect.objectContaining({ error: "quebrou", stack: failure.stack, userId: 9 }),
    );
    expect(error).toHaveBeenCalledWith("Falha B", expect.objectContaining({ error: "texto", stack: undefined }));
  });
});

describe("utils/logger - Logtail", () => {
  const keys = ["ENVIRONMENT", "LOGTAIL_TOKEN", "ENABLE_LOGTAIL"] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeAll(() => {
    for (const key of keys) saved[key] = process.env[key];
  });

  afterAll(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("adiciona o transporte do Logtail quando ha token fora do desenvolvimento", () => {
    process.env.ENVIRONMENT = "production";
    process.env.LOGTAIL_TOKEN = "token-de-teste";
    delete process.env.ENABLE_LOGTAIL;
    let transports = 0;
    let logtailCalls = 0;
    jest.isolateModules(() => {
      jest.doMock("@logtail/node", () => ({ Logtail: jest.fn() }));
      jest.doMock("@logtail/winston", () => ({
        LogtailTransport: jest.fn(() => new winston.transports.Console({ silent: true })),
      }));
      const isolated = require("../logger") as { default: winston.Logger };
      const { Logtail } = require("@logtail/node") as { Logtail: jest.Mock };
      transports = isolated.default.transports.length;
      logtailCalls = Logtail.mock.calls.length;
    });
    expect(logtailCalls).toBe(1);
    expect(transports).toBe(2);
  });
});

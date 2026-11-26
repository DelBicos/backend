import fs from "fs";
import type { Options, Sequelize } from "sequelize";

jest.mock("dotenv", () => ({ __esModule: true, default: { config: jest.fn() } }));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logError: jest.fn(),
}));

jest.mock("../../utils/mongoConnectionRetry", () => ({
  connectMongoWithRetry: jest.fn(async (connect: () => Promise<unknown>) => {
    await connect();
  }),
}));

type Listener = (payload?: unknown) => void;

interface FakeConnection {
  readyState: number;
  listeners: Record<string, Listener>;
  on: jest.Mock;
  openUri: jest.Mock;
}

jest.mock("mongoose", () => ({
  __esModule: true,
  default: {
    connect: jest.fn(async () => undefined),
    createConnection: jest.fn(() => {
      const connection: FakeConnection = {
        readyState: 0,
        listeners: {},
        on: jest.fn(),
        openUri: jest.fn(async () => undefined),
      };
      connection.on.mockImplementation((event: string, listener: Listener) => {
        connection.listeners[event] = listener;
        return connection;
      });
      return connection;
    }),
  },
}));

type DatabaseModule = typeof import("../database");
type LoggerMock = { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };

interface Loaded {
  db: DatabaseModule;
  logger: LoggerMock;
  logError: jest.Mock;
  retry: jest.Mock;
  mongooseConnect: jest.Mock;
  chat: FakeConnection;
}

const ENV_KEYS = [
  "SEQUELIZE_HOST",
  "SEQUELIZE_PORT",
  "SEQUELIZE_DB_NAME",
  "SEQUELIZE_DB_USER",
  "SEQUELIZE_DB_PASS",
  "SEQUELIZE_DIALECT",
  "RUNNING_IN_DOCKER",
  "MONGODB_URI",
  "MONGODB_CHAT_URI",
  "ENVIRONMENT",
  "DATABASE_URL",
  "DB_LOGGING",
  "DB_SYNC",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let existsSpy: jest.SpyInstance;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

function load(dockerFile = false): Loaded {
  existsSpy.mockImplementation((path: fs.PathLike) => dockerFile && path === "/.dockerenv");
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    const db = require("../database") as DatabaseModule;
    const loggerModule = require("../../utils/logger") as { default: LoggerMock; logError: jest.Mock };
    const retryModule = require("../../utils/mongoConnectionRetry") as { connectMongoWithRetry: jest.Mock };
    const mongooseModule = require("mongoose") as {
      default: { connect: jest.Mock; createConnection: jest.Mock };
    };
    loaded = {
      db,
      logger: loggerModule.default,
      logError: loggerModule.logError,
      retry: retryModule.connectMongoWithRetry,
      mongooseConnect: mongooseModule.default.connect,
      chat: db.chatMongoConnection as unknown as FakeConnection,
    };
  });
  return loaded as Loaded;
}

/** `options` existe em runtime, mas nao esta nos tipos publicos do Sequelize. */
const optionsOf = (sequelize: Sequelize) => (sequelize as unknown as { options: Options }).options;

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  existsSpy = jest.spyOn(fs, "existsSync");
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  existsSpy.mockRestore();
});

describe("config/database - URI do Mongo do chat", () => {
  it("usa MONGODB_CHAT_URI quando definida, sem alterar fora do Docker", async () => {
    setEnv({ MONGODB_CHAT_URI: "mongodb://localhost:27017/chat" });
    const { chat, retry } = load();
    await flush();
    expect(retry).toHaveBeenCalledWith(expect.any(Function), "MongoDB (chat)");
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://localhost:27017/chat");
  });

  it("deriva a URI do chat do mesmo host de MONGODB_URI", async () => {
    setEnv({ MONGODB_URI: "mongodb://user:senha@db.exemplo.com:27017/logs_db?authSource=admin" });
    const { chat, logger } = load();
    await flush();
    expect(chat.openUri).toHaveBeenCalledWith(
      "mongodb://user:senha@db.exemplo.com:27017/delbicos_chat?authSource=admin",
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("derivado de MONGODB_URI"));
    expect(logger.info).toHaveBeenCalledWith("MongoDB chat: mongodb://db.exemplo.com:27017/delbicos_chat?authSource=admin");
  });

  it("troca so o banco por texto quando MONGODB_URI nao e uma URL valida", async () => {
    setEnv({ MONGODB_URI: "mongodb://host:porta/logs_db" });
    const { chat } = load();
    await flush();
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://host:porta/delbicos_chat");
  });

  it("usa localhost como fallback sem nenhuma URI", async () => {
    setEnv({});
    const { chat, logger } = load();
    await flush();
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://localhost:27017/delbicos_chat");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("fallback localhost"));
  });
});

describe("config/database - Docker", () => {
  it("troca localhost por mongo nas variaveis quando RUNNING_IN_DOCKER=true", async () => {
    setEnv({
      RUNNING_IN_DOCKER: "true",
      MONGODB_URI: "mongodb://localhost:27017/logs_db",
      MONGODB_CHAT_URI: "mongodb://127.0.0.1:27017/chat",
    });
    const { chat, logger } = load();
    await flush();
    expect(process.env.MONGODB_URI).toBe("mongodb://mongo:27017/logs_db");
    expect(process.env.MONGODB_CHAT_URI).toBe("mongodb://mongo:27017/chat");
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://mongo:27017/chat");
    expect(logger.warn).toHaveBeenCalledWith('MongoDB: host "localhost" substituído por "mongo" (Docker).');
  });

  it("detecta Docker pelo host do Postgres e mantem hosts que nao sao locais", async () => {
    setEnv({ SEQUELIZE_HOST: "postgres", SEQUELIZE_DIALECT: "postgres", MONGODB_URI: "mongodb://mongo:27017/logs" });
    const { chat } = load();
    await flush();
    expect(process.env.MONGODB_URI).toBe("mongodb://mongo:27017/logs");
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://mongo:27017/delbicos_chat");
  });

  it("detecta Docker por /.dockerenv e corrige URI invalida por texto", async () => {
    setEnv({ MONGODB_CHAT_URI: "mongodb://localhost:porta/chat" });
    const { chat } = load(true);
    await flush();
    expect(existsSpy).toHaveBeenCalledWith("/.dockerenv");
    expect(chat.openUri).toHaveBeenCalledWith("mongodb://mongo:porta/chat");
  });
});

describe("config/database - conexao do chat", () => {
  it("so registra erro depois da primeira conexao bem-sucedida", () => {
    setEnv({});
    const { chat, logError, logger, db } = load();
    chat.listeners.error(new Error("antes"));
    expect(logError).not.toHaveBeenCalled();

    chat.listeners.connected();
    expect(logger.info).toHaveBeenCalledWith("Conectado ao MongoDB (chat).");
    chat.listeners.error(new Error("depois"));
    expect(logError).toHaveBeenCalledWith("Erro MongoDB (chat):", expect.any(Error));

    expect(db.isChatMongoReady()).toBe(false);
    chat.readyState = 1;
    expect(db.isChatMongoReady()).toBe(true);
  });
});

describe("config/database - connectMongo", () => {
  it("avisa e nao conecta sem MONGODB_URI", async () => {
    setEnv({});
    const { db, logger, mongooseConnect } = load();
    await db.connectMongo();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("MONGODB_URI não definida"));
    expect(mongooseConnect).not.toHaveBeenCalled();
  });

  it("conecta com retentativa usando a URI normalizada", async () => {
    setEnv({ RUNNING_IN_DOCKER: "true", MONGODB_URI: "mongodb://localhost:27017/logs" });
    const { db, logger, retry, mongooseConnect } = load();
    await db.connectMongo();
    expect(retry).toHaveBeenCalledWith(expect.any(Function), "MongoDB (logs)");
    expect(mongooseConnect).toHaveBeenCalledWith("mongodb://mongo:27017/logs");
    expect(logger.info).toHaveBeenCalledWith("Conectado ao MongoDB.");
  });

  it("registra erro quando a conexao falha", async () => {
    setEnv({ MONGODB_URI: "mongodb://db:27017/logs" });
    const { db, logError, mongooseConnect } = load();
    mongooseConnect.mockRejectedValueOnce(new Error("recusado"));
    await db.connectMongo();
    expect(logError).toHaveBeenCalledWith("Erro MongoDB:", expect.any(Error));
  });
});

describe("config/database - Sequelize", () => {
  it("usa DATABASE_URL com postgres, SSL e log de SQL", () => {
    setEnv({ DATABASE_URL: "postgres://u:p@neon.tech:5432/db", DB_LOGGING: "true" });
    const { db, logger } = load();
    const options = optionsOf(db.sequelize);
    expect(options.dialect).toBe("postgres");
    expect(options.dialectOptions).toEqual(
      expect.objectContaining({ ssl: { require: true, rejectUnauthorized: false } }),
    );
    expect(typeof options.logging).toBe("function");
    (options.logging as (sql: string) => void)("SELECT 1");
    expect(logger.debug).toHaveBeenCalledWith("SELECT 1");
  });

  it("usa variaveis individuais sem SSL no desenvolvimento local", () => {
    setEnv({
      SEQUELIZE_DIALECT: "postgres",
      SEQUELIZE_HOST: "db-local",
      SEQUELIZE_PORT: "6543",
      SEQUELIZE_DB_NAME: "delbicos",
      SEQUELIZE_DB_USER: "dev",
    });
    const { db } = load();
    const options = optionsOf(db.sequelize);
    expect(options.host).toBe("db-local");
    expect(options.port).toBe(6543);
    expect(options.logging).toBe(false);
    expect(options.dialectOptions).toEqual({ ssl: false });
    expect(db.sequelize.config.database).toBe("delbicos");
    expect(db.sequelize.config.username).toBe("dev");
  });

  it("exige SSL no postgres fora do desenvolvimento e usa valores padrao", () => {
    setEnv({ SEQUELIZE_DIALECT: "postgres", ENVIRONMENT: "production" });
    const { db } = load();
    expect(optionsOf(db.sequelize).dialectOptions).toEqual({
      ssl: { require: true, rejectUnauthorized: false },
    });
    expect(optionsOf(db.sequelize).port).toBe(5432);
    expect(db.sequelize.config.database).toBe("neondb");
    expect(db.sequelize.config.username).toBe("neondb_owner");
  });

  it("cai para mysql sem dialeto definido e sem URL de postgres", () => {
    setEnv({});
    const { db } = load();
    expect(optionsOf(db.sequelize).dialect).toBe("mysql");
    expect(optionsOf(db.sequelize).dialectOptions).toEqual({ ssl: undefined });
  });
});

describe("config/database - connectDatabase", () => {
  it("autentica e sincroniza no desenvolvimento local", async () => {
    setEnv({ SEQUELIZE_DIALECT: "postgres" });
    const { db, logger } = load();
    const authenticate = jest.spyOn(db.sequelize, "authenticate").mockResolvedValue(undefined);
    const sync = jest.spyOn(db.sequelize, "sync").mockResolvedValue(db.sequelize);
    await db.connectDatabase();
    expect(authenticate).toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith({ alter: true });
    expect(logger.info).toHaveBeenCalledWith("Tabelas sincronizadas no banco local.");
    expect(logger.info).toHaveBeenCalledWith("Database connection established [POSTGRES]");
  });

  it("informa a sincronizacao no Neon quando DB_SYNC=true", async () => {
    setEnv({ ENVIRONMENT: "production", DB_SYNC: "true", DATABASE_URL: "postgres://u:p@ep.neon.tech/db" });
    const { db, logger } = load();
    jest.spyOn(db.sequelize, "authenticate").mockResolvedValue(undefined);
    jest.spyOn(db.sequelize, "sync").mockResolvedValue(db.sequelize);
    await db.connectDatabase();
    expect(logger.info).toHaveBeenCalledWith("Tabelas sincronizadas no Neon.");
  });

  it("nao sincroniza em producao sem DB_SYNC", async () => {
    setEnv({ ENVIRONMENT: "production", DATABASE_URL: "postgres://u:p@host/db" });
    const { db } = load();
    jest.spyOn(db.sequelize, "authenticate").mockResolvedValue(undefined);
    const sync = jest.spyOn(db.sequelize, "sync").mockResolvedValue(db.sequelize);
    await db.connectDatabase();
    expect(sync).not.toHaveBeenCalled();
  });

  it("registra erro quando a autenticacao falha", async () => {
    setEnv({ SEQUELIZE_DIALECT: "postgres" });
    const { db, logError } = load();
    jest.spyOn(db.sequelize, "authenticate").mockRejectedValue(new Error("sem banco"));
    await db.connectDatabase();
    expect(logError).toHaveBeenCalledWith("Unable to connect to the database:", expect.any(Error));
  });
});

import { Sequelize } from "sequelize";
import pg from "pg";

const refused = async (): Promise<never> => {
  throw new Error("Unit tests must not open a database connection");
};

/**
 * Real Sequelize instance so Model.init can register models, with every
 * connection entry point replaced. Nothing in this module dials Postgres
 * or Mongo.
 */
export const sequelize = new Sequelize({
  dialect: "postgres",
  host: "127.0.0.1",
  port: 1,
  username: "unit",
  password: "unit",
  database: "unit_tests",
  logging: false,
  dialectModule: pg,
});

sequelize.authenticate = refused as typeof sequelize.authenticate;
sequelize.sync = refused as typeof sequelize.sync;
sequelize.query = refused as typeof sequelize.query;

const manager = sequelize.connectionManager as unknown as {
  getConnection: () => Promise<never>;
};
manager.getConnection = refused;

type UnitTransaction = {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

sequelize.transaction = (async (
  arg1?: unknown,
  arg2?: unknown,
): Promise<unknown> => {
  const tx: UnitTransaction = {
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  const callback =
    typeof arg1 === "function"
      ? arg1
      : typeof arg2 === "function"
        ? arg2
        : null;
  if (callback) {
    return (callback as (transaction: UnitTransaction) => unknown)(tx);
  }
  return tx;
}) as typeof sequelize.transaction;

export async function connectMongo(): Promise<void> {
  return undefined;
}

const chatModels = new Map<string, Record<string, unknown>>();

export const chatMongoConnection = {
  readyState: 0,
  on() {
    return this;
  },
  model(name: string) {
    const existing = chatModels.get(name);
    if (existing) return existing;
    const offline = () => {
      throw new Error("Chat Mongo is mocked in unit tests");
    };
    const stub = { find: offline, findOne: offline, create: offline };
    chatModels.set(name, stub);
    return stub;
  },
};

export function isChatMongoReady(): boolean {
  return false;
}

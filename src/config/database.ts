import fs from "fs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { Sequelize } from "sequelize";
import pg from "pg"; // Importação essencial da POC

// override: false — variáveis do Docker Compose têm prioridade sobre o .env copiado
dotenv.config({ override: false });

/** Ambiente Docker Compose local (Postgres no serviço "postgres"). */
function isRunningInDocker(): boolean {
  return (
    process.env.SEQUELIZE_HOST === "postgres" ||
    process.env.RUNNING_IN_DOCKER === "true" ||
    fs.existsSync("/.dockerenv")
  );
}

/**
 * Dentro do container, localhost não alcança o Mongo — usa o serviço "mongo".
 * Corrige .env copiado com mongodb://localhost:27017/...
 */
function normalizeMongoUriForRuntime(uri: string): string {
  if (!isRunningInDocker()) return uri;

  try {
    const url = new URL(uri);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const previous = url.hostname;
      url.hostname = "mongo";
      console.warn(
        `⚠️ MongoDB: host "${previous}" substituído por "mongo" (Docker).`,
      );
    }
    return url.toString();
  } catch {
    return uri.replace(/localhost|127\.0\.0\.1/g, "mongo");
  }
}

function applyDockerMongoEnvFix(): void {
  if (!isRunningInDocker()) return;

  for (const key of ["MONGODB_URI", "MONGODB_CHAT_URI"] as const) {
    const value = process.env[key];
    if (!value) continue;
    const normalized = normalizeMongoUriForRuntime(value);
    if (normalized !== value) {
      process.env[key] = normalized;
    }
  }
}

applyDockerMongoEnvFix();

const environment = process.env.ENVIRONMENT || "development";
const databaseUrl = process.env.DATABASE_URL;

/**
 * Determina o dialect do banco de dados
 */
const getDialect = (): "mysql" | "postgres" => {
  if (process.env.SEQUELIZE_DIALECT) {
    return process.env.SEQUELIZE_DIALECT as "mysql" | "postgres";
  }
  return databaseUrl?.includes("postgres") ? "postgres" : "mysql";
};

/**
 * Retorna as opções de SSL apropriadas (Aprimorado com a lógica da POC)
 */
const getSSLOptions = (dialect: "mysql" | "postgres") => {
  if (dialect === "postgres") {
    if (!process.env.DATABASE_URL && environment === "development") {
      return false; // Docker local Postgres does not support SSL
    }
    // SSL only when there's an external DATABASE_URL (e.g. Neon) or non-development env
    return {
      require: true,
      rejectUnauthorized: false, // Necessário para o Neon
    };
  }
  if (environment !== "development") {
    return { ssl: "Amazon RDS" };
  }
  return undefined;
};

/**
 * Cria a conexão com o Sequelize
 */
const generateSequelizeConnection = (): Sequelize => {
  const dialect = getDialect();

  // Se existir DATABASE_URL (Caso do seu Neon)
  if (databaseUrl) {
    return new Sequelize(databaseUrl, {
      dialect,
      dialectModule: pg, // Injetando o driver pg como na POC
      dialectOptions: {
        ssl: getSSLOptions(dialect),
      },
      logging: process.env.DB_LOGGING === "true" ? console.log : false,
    });
  }

  // Fallback para variáveis individuais (Docker/RDS)
  return new Sequelize(
    process.env.SEQUELIZE_DB_NAME || "neondb",
    process.env.SEQUELIZE_DB_USER || "neondb_owner",
    process.env.SEQUELIZE_DB_PASS,
    {
      host: process.env.SEQUELIZE_HOST,
      port: Number(process.env.SEQUELIZE_PORT) || 5432,
      dialect,
      dialectModule: dialect === "postgres" ? pg : undefined,
      dialectOptions: {
        ssl: getSSLOptions(dialect),
      },
      logging: process.env.DB_LOGGING === "true" ? console.log : false,
    },
  );
};

export const sequelize = generateSequelizeConnection();

/**
 * Autentica e Sincroniza o banco
 */
export async function connectDatabase(): Promise<void> {
  try {
    await sequelize.authenticate();

    // Lógica da POC: Sincronização automática de tabelas
    // O 'alter: true' atualiza o banco sem apagar dados se você mudar o Model
    if (environment === "development" || process.env.DB_SYNC === "true") {
      await sequelize.sync({ alter: true });
      if (databaseUrl?.includes("aws")) {
        console.log("✅ Tabelas sincronizadas no RDS.");
      } else if (databaseUrl?.includes("neon")) {
        console.log("✅ Tabelas sincronizadas no Neon.");
      } else {
        console.log("✅ Tabelas sincronizadas no banco local.");
      }
    }

    const dialect = getDialect();
    console.log(
      `✅ Database connection established [${dialect.toUpperCase()}]`,
    );
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
    // process.exit(1); // Opcional: encerra se o banco falhar
  }
}

export async function connectMongo() {
  try {
    const rawUri = process.env.MONGODB_URI;
    if (!rawUri)
      return console.warn(
        "⚠️ MONGODB_URI não definida. Logs salvos apenas localmente.",
      );

    const uri = normalizeMongoUriForRuntime(rawUri);
    await mongoose.connect(uri);
    console.log("✅ Conectado ao MongoDB.");
  } catch (error) {
    console.error("❌ Erro MongoDB:", error);
  }
}

/**
 * Resolve a URI do MongoDB do chat.
 * Prioridade: MONGODB_CHAT_URI > mesmo host de MONGODB_URI com DB delbicos_chat > localhost.
 * Assim, no Docker (MONGODB_URI=mongodb://mongo:27017/logs_db) o chat usa mongo:27017
 * mesmo sem MONGODB_CHAT_URI explícita.
 */
function resolveChatMongoUri(): string {
  let uri: string;

  if (process.env.MONGODB_CHAT_URI) {
    uri = process.env.MONGODB_CHAT_URI;
  } else if (process.env.MONGODB_URI) {
    const logsUri = process.env.MONGODB_URI;
    try {
      const url = new URL(logsUri);
      url.pathname = "/delbicos_chat";
      uri = url.toString();
    } catch {
      const withoutDb = logsUri.replace(/\/[^/]*$/, "");
      uri = `${withoutDb}/delbicos_chat`;
    }
    console.warn(
      `⚠️ MONGODB_CHAT_URI não definida. Chat derivado de MONGODB_URI.`,
    );
  } else {
    uri = "mongodb://localhost:27017/delbicos_chat";
    console.warn(
      "⚠️ MONGODB_CHAT_URI não definida. Chat usando fallback localhost.",
    );
  }

  return normalizeMongoUriForRuntime(uri);
}

const chatMongoUri = resolveChatMongoUri();

console.info(
  `ℹ️ MongoDB chat: ${chatMongoUri.replace(/\/\/([^@]+@)?/, "//")}`,
);

export const chatMongoConnection = mongoose.createConnection(chatMongoUri);

chatMongoConnection.on("connected", () => {
  console.log("✅ Conectado ao MongoDB (chat).");
});

chatMongoConnection.on("error", (error) => {
  console.error("❌ Erro MongoDB (chat):", error);
});

/** Indica se a conexão dedicada do chat está pronta para operações. */
export function isChatMongoReady(): boolean {
  return chatMongoConnection.readyState === 1;
}

// As conexoes sao abertas explicitamente pelo bootstrap (server.ts),
// e nao como efeito colateral do import deste modulo.

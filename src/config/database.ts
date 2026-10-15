import fs from "fs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { Sequelize } from "sequelize";
import pg from "pg";
import { connectMongoWithRetry } from "../utils/mongoConnectionRetry";

dotenv.config({ override: false });

const environment =
  process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
const isTest =
  environment === "test" || process.env.NODE_ENV === "test";

/* -------------------------------------------------------------------------- */
/*                              DOCKER / MONGO FIX                             */
/* -------------------------------------------------------------------------- */

function isRunningInDocker(): boolean {
  return (
    process.env.SEQUELIZE_HOST === "postgres" ||
    process.env.RUNNING_IN_DOCKER === "true" ||
    fs.existsSync("/.dockerenv")
  );
}

function normalizeMongoUriForRuntime(uri: string): string {
  if (!isRunningInDocker()) return uri;

  try {
    const url = new URL(uri);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.hostname = "mongo";
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
    if (normalized !== value) process.env[key] = normalized;
  }
}

applyDockerMongoEnvFix();

/* -------------------------------------------------------------------------- */
/*                              DIALECT / SSL                                  */
/* -------------------------------------------------------------------------- */

const databaseUrl = process.env.DATABASE_URL;

const getDialect = (): "mysql" | "postgres" => {
  if (process.env.SEQUELIZE_DIALECT) {
    return process.env.SEQUELIZE_DIALECT as "mysql" | "postgres";
  }
  if (databaseUrl?.includes("postgres")) return "postgres";
  return "postgres";
};

/**
 * Detecta se o host é LOCAL (Docker, localhost).
 * Qualquer host que NÃO esteja nesta lista é considerado remoto → SSL obrigatório.
 */
function isLocalHost(host?: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "postgres" ||
    h === "mongo" ||
    h === "host.docker.internal"
  );
}

/**
 * SSL obrigatório para Postgres em qualquer host remoto (Neon, RDS, Supabase).
 * Docker/local NÃO usa SSL.
 *
 * ⚠️ NUNCA retorna `false`/`undefined` para Neon — esse era o bug.
 */
const getSSLOptions = (
  dialect: "mysql" | "postgres",
  host?: string
): false | { require: boolean; rejectUnauthorized: boolean } | { ssl: string } => {
  if (dialect === "postgres") {
    const effectiveHost = host || process.env.SEQUELIZE_HOST;

    // Neon, RDS, Supabase → SSL obrigatório
    if (isLocalHost(effectiveHost)) return false;

    return {
      require: true,
      rejectUnauthorized: false,
    };
  }

  // MySQL/RDS em produção
  if (environment !== "development") {
    return { ssl: "Amazon RDS" };
  }
  return false;
};

/* -------------------------------------------------------------------------- */
/*                              SEQUELIZE                                      */
/* -------------------------------------------------------------------------- */

const generateSequelizeConnection = (): Sequelize => {
  const dialect = getDialect();

  // Caso 1: DATABASE_URL (Neon, RDS, etc)
  if (databaseUrl) {
    return new Sequelize(databaseUrl, {
      dialect,
      dialectModule: dialect === "postgres" ? pg : undefined,
      dialectOptions: {
        ssl: getSSLOptions(dialect, process.env.SEQUELIZE_HOST),
      },
      logging: process.env.DB_LOGGING === "true" ? console.log : false,
    });
  }

  // Caso 2: variáveis individuais
  return new Sequelize(
    process.env.SEQUELIZE_DB_NAME || "neondb",
    process.env.SEQUELIZE_DB_USER || "neondb_owner",
    process.env.SEQUELIZE_DB_PASS || "",
    {
      host: process.env.SEQUELIZE_HOST,
      port: Number(process.env.SEQUELIZE_PORT) || 5432,
      dialect,
      dialectModule: dialect === "postgres" ? pg : undefined,
      dialectOptions: {
        ssl: getSSLOptions(dialect, process.env.SEQUELIZE_HOST),
      },
      logging: process.env.DB_LOGGING === "true" ? console.log : false,
    }
  );
};

export const sequelize = generateSequelizeConnection();

/* -------------------------------------------------------------------------- */
/*                              CONNECT DATABASE                               */
/* -------------------------------------------------------------------------- */

async function connectDatabase(): Promise<void> {
  try {
    await sequelize.authenticate();

    if (isTest) {
      console.log("✅ Conexão de teste OK (sem sync)");
      return;
    }

    if (environment === "development" && process.env.DB_SYNC === "true") {
      await sequelize.sync({ alter: true });
      console.log("✅ Tabelas sincronizadas (dev).");
    }

    const dialect = getDialect();
    console.log(`✅ Database connection established [${dialect.toUpperCase()}]`);
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
  }
}

/* -------------------------------------------------------------------------- */
/*                              MONGODB (LOGS)                                 */
/* -------------------------------------------------------------------------- */

export async function connectMongo() {
  try {
    const rawUri = process.env.MONGODB_URI;
    if (!rawUri) {
      console.warn("⚠️ MONGODB_URI não definida. Logs salvos apenas localmente.");
      return;
    }
    const uri = normalizeMongoUriForRuntime(rawUri);
    await connectMongoWithRetry(() => mongoose.connect(uri), "MongoDB (logs)");
    console.log("✅ Conectado ao MongoDB.");
  } catch (error) {
    console.error("❌ Erro MongoDB:", error);
  }
}

/* -------------------------------------------------------------------------- */
/*                              MONGODB (CHAT)                                 */
/* -------------------------------------------------------------------------- */

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
    console.warn("⚠️ MONGODB_CHAT_URI não definida. Chat derivado de MONGODB_URI.");
  } else {
    uri = "mongodb://localhost:27017/delbicos_chat";
    console.warn("⚠️ MONGODB_CHAT_URI não definida. Chat usando fallback localhost.");
  }

  return normalizeMongoUriForRuntime(uri);
}

export const chatMongoConnection = mongoose.createConnection();
let chatConnectedOnce = false;

chatMongoConnection.on("connected", () => {
  chatConnectedOnce = true;
  console.log("✅ Conectado ao MongoDB (chat).");
});

chatMongoConnection.on("error", (error) => {
  if (chatConnectedOnce) console.error("❌ Erro MongoDB (chat):", error);
});

/* -------------------------------------------------------------------------- */
/*                              INICIALIZAÇÃO                                  */
/* -------------------------------------------------------------------------- */

if (!isTest) {
  const chatMongoUri = resolveChatMongoUri();
  console.info(
    `ℹ️ MongoDB chat: ${chatMongoUri.replace(/\/\/([^@]+@)?/, "//")}`
  );

  void connectMongoWithRetry(
    () => chatMongoConnection.openUri(chatMongoUri),
    "MongoDB (chat)"
  );

  connectMongo();
} else {
  console.info("ℹ️ MongoDB: pulado em ambiente de teste");
}

export function isChatMongoReady(): boolean {
  return chatMongoConnection.readyState === 1;
}

connectDatabase();
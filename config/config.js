require("dotenv").config();

const getDialect = () => {
  if (process.env.SEQUELIZE_DIALECT) return process.env.SEQUELIZE_DIALECT;
  if (process.env.RDS_DIALECT) return process.env.RDS_DIALECT;
  return "postgres";
};

/**
 * Detecta se o host é local (sem SSL) ou remoto (com SSL).
 * Neon, RDS, Supabase, etc. exigem SSL.
 */
const isLocalHost = (host) => {
  if (!host) return true;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host === "::1"
  );
};

const getSSLOptions = (dialect, host) => {
  if (dialect !== "postgres") return undefined;

  // Se for local, não precisa SSL
  if (isLocalHost(host)) return undefined;

  // Qualquer host remoto → SSL obrigatório (Neon, RDS, etc.)
  return {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  };
};

const env = process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
const dialect = getDialect();

const getDefaultPort = (currentDialect) =>
  currentDialect === "postgres" ? 5432 : 3306;

if (process.env.__DEV__) {
  console.log("🔧 Sequelize Configuration:");
  console.log("Environment:", env);
  console.log("Dialect:", dialect);
  console.log({
    username: process.env.SEQUELIZE_DB_USER,
    password: process.env.SEQUELIZE_DB_PASS ? "***" : undefined,
    database: process.env.SEQUELIZE_DB_NAME,
    host: process.env.SEQUELIZE_HOST,
    port: process.env.SEQUELIZE_PORT,
  });
}

const config = {
  development: {
    username: process.env.SEQUELIZE_DB_USER || "root",
    password: process.env.SEQUELIZE_DB_PASS || "password",
    database: process.env.SEQUELIZE_DB_NAME || "my_database",
    host: process.env.SEQUELIZE_HOST || "localhost",
    port: Number(process.env.SEQUELIZE_PORT) || getDefaultPort(dialect),
    dialect,
    dialectOptions: getSSLOptions(dialect, process.env.SEQUELIZE_HOST),
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
  },
  production: {
    ...(process.env.DATABASE_URL ? { use_env_variable: "DATABASE_URL" } : {}),
    username: process.env.SEQUELIZE_DB_USER,
    password: process.env.SEQUELIZE_DB_PASS,
    database: process.env.SEQUELIZE_DB_NAME,
    host: process.env.SEQUELIZE_HOST,
    port: Number(process.env.SEQUELIZE_PORT) || getDefaultPort(dialect),
    dialect,
    dialectOptions: getSSLOptions(dialect, process.env.SEQUELIZE_HOST),
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
  },
};

module.exports = config;
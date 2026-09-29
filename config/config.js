require("dotenv").config();

/**
 * Determina o dialect do banco de dados
 * Prioridade: SEQUELIZE_DIALECT > "postgres"
 */
const getDialect = () => {
  if (process.env.SEQUELIZE_DIALECT) {
    return process.env.SEQUELIZE_DIALECT;
  }
  return "postgres";
};

/**
 * Retorna as opções de SSL apropriadas para o dialect
 */
// No seu src/config/config.js
const getSSLOptions = (dialect, environment) => {
  if (dialect === "postgres") {
    if (environment === "development" && !process.env.DATABASE_URL) {
      return undefined;
    }
    return {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    };
  }
  return undefined;
};

const env = process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
const dialect = getDialect();

const getDefaultPort = (currentDialect) => {
  return currentDialect === "postgres" ? 5432 : 3306;
};

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
    dialectOptions: getSSLOptions(dialect, "development"),
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
  },
  production: {
    // Opção 1: DATABASE_URL (Neon Postgres)
    ...(process.env.DATABASE_URL ? { use_env_variable: "DATABASE_URL" } : {}),
    // Opção 2: Variáveis individuais (host, usuário e senha do banco)
    username: process.env.SEQUELIZE_DB_USER,
    password: process.env.SEQUELIZE_DB_PASS,
    database: process.env.SEQUELIZE_DB_NAME,
    host: process.env.SEQUELIZE_HOST,
    port: Number(process.env.SEQUELIZE_PORT) || getDefaultPort(dialect),
    dialect,
    dialectOptions: getSSLOptions(dialect, env),
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
  },
};

module.exports = config;

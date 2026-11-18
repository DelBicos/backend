/**
 * Prepara o banco antes de subir a API (usado no Startup Command do Azure):
 *   1. aplica as migrations pendentes;
 *   2. se o banco estiver vazio (sem categorias), carrega o catalogo de demonstracao.
 *
 * Os seeders nao sao rastreados pelo sequelize-cli, entao rodar db:seed:all em um
 * banco que ja tem dados duplicaria o catalogo. Por isso so semeia banco vazio.
 *
 * Uso: node scripts/bootstrap-database.js && npm start
 */
const { execSync } = require("child_process");
const { Sequelize } = require("sequelize");

if (!process.env.NODE_ENV && process.env.ENVIRONMENT) {
  process.env.NODE_ENV = process.env.ENVIRONMENT;
}
const env = process.env.NODE_ENV || "development";

const run = (command) => execSync(command, { stdio: "inherit", env: process.env });

async function countCategories() {
  const config = require("../config/config.js")[env];
  const sequelize = config.use_env_variable
    ? new Sequelize(process.env[config.use_env_variable], config)
    : new Sequelize(config.database, config.username, config.password, config);
  try {
    const [rows] = await sequelize.query('SELECT count(*)::int AS total FROM "category"');
    return rows[0].total;
  } finally {
    await sequelize.close();
  }
}

async function main() {
  run("npx sequelize-cli db:migrate");
  const categories = await countCategories();
  if (categories === 0) {
    process.stdout.write("Banco vazio: carregando o catalogo de demonstracao.\n");
    run("npx sequelize-cli db:seed:all");
  } else {
    process.stdout.write(`Banco com ${categories} categorias: seeders ignorados.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Falha ao preparar o banco: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});

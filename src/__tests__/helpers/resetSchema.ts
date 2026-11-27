import fs from "fs";
import path from "path";
import { QueryTypes, Sequelize } from "sequelize";
import { sequelize } from "../../config/database";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../migrations");

/**
 * Cria (se preciso) um banco de teste dedicado no mesmo PostgreSQL local
 * descartável de PR2_TEST_DATABASE_URL. Ex.: pr2_test → pr2_test_ticket.
 * Assim a suíte não disputa tabelas com outras suítes de integração.
 */
export async function ensureTestDatabase(adminUri: string, database: string): Promise<void> {
  if (!/^pr2_test_[a-z0-9_]+$/.test(database)) {
    throw new Error(`Banco de teste inválido: ${database}`);
  }
  const admin = new Sequelize(adminUri, { logging: false });
  try {
    const rows = await admin.query("SELECT 1 FROM pg_database WHERE datname = :database", {
      replacements: { database },
      type: QueryTypes.SELECT,
    });
    if (rows.length === 0) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.close();
  }
}

/**
 * Apaga o schema `public` do banco de teste e aplica todas as migrations.
 * Recusa rodar fora de um banco `pr2_test*`, para nunca atingir o banco real.
 */
export async function resetSchema(): Promise<void> {
  const [{ db }] = await sequelize.query<{ db: string }>("SELECT current_database() AS db", {
    type: QueryTypes.SELECT,
  });
  if (!db.startsWith("pr2_test")) {
    throw new Error(`resetSchema recusado: banco "${db}" não é de teste.`);
  }

  await sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort();

  for (const file of files) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== "function") continue;
    await migration.up(sequelize.getQueryInterface(), Sequelize);
  }
}

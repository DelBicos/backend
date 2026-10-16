import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import { sequelize } from '../../config/database';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');

export async function resetSchema(): Promise<void> {
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
      name VARCHAR(255) NOT NULL PRIMARY KEY
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort();

  for (const file of files) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== 'function') continue;
    await migration.up(sequelize.getQueryInterface(), Sequelize);

    await sequelize.query(
      'INSERT INTO "SequelizeMeta" (name) VALUES (:name) ON CONFLICT DO NOTHING',
      { replacements: { name: file } }
    );
  }
}
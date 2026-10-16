import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import { sequelize } from '../../config/database';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');

export async function resetSchema(): Promise<void> {
  console.log('🔧 resetSchema: iniciando...');
  console.log('🔧 MIGRATIONS_DIR:', MIGRATIONS_DIR);

  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('🔧 resetSchema: schema dropado');

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort();

  console.log(`🔧 resetSchema: ${files.length} migrations encontradas`);

  for (const file of files) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== 'function') continue;
    await migration.up(sequelize.getQueryInterface(), Sequelize);
  }

  console.log('🔧 resetSchema: concluído');
}
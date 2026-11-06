import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { URL } from 'url';

const testDbUrl = process.env.PR2_TEST_DATABASE_URL;

if (!testDbUrl) {
  throw new Error(
    '❌ PR2_TEST_DATABASE_URL não definida. Adicione no .env e rode "npm run test:db:up".',
  );
}

const url = new URL(testDbUrl);

process.env.SEQUELIZE_HOST = url.hostname;
process.env.SEQUELIZE_PORT = url.port || '5432';
process.env.SEQUELIZE_DB_NAME = url.pathname.replace(/^\//, '');
process.env.SEQUELIZE_DB_USER = decodeURIComponent(url.username);
process.env.SEQUELIZE_DB_PASS = decodeURIComponent(url.password);
process.env.SEQUELIZE_DIALECT = 'postgres';

console.log(
  `🧪 Testes apontando para ${process.env.SEQUELIZE_HOST}:${process.env.SEQUELIZE_PORT}/${process.env.SEQUELIZE_DB_NAME}`,
);
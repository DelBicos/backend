import './setup-db';

import { sequelize } from '../config/database';

jest.setTimeout(120000);

beforeAll(async () => {
  await sequelize.authenticate();
  console.log('✅ Conexão com Postgres de teste OK');
});

afterAll(async () => {
  await sequelize.close();
  console.log('✅ Conexão fechada');
});
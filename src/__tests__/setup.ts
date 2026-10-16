import './setup-db';

import { sequelize } from '../config/database';

jest.setTimeout(60000);

beforeAll(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com Postgres de teste OK');
  } catch (error) {
    console.error('❌ Erro ao conectar no Postgres de teste:', error);
    throw error;
  }
});

afterAll(async () => {
  try {
    await sequelize.close();
    console.log('✅ Conexão fechada');
  } catch (error) {
    console.error('❌ Erro ao fechar conexão:', error);
  }
});
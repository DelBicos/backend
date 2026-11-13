import { sequelize } from "../mocks/database";

afterAll(async () => {
  await sequelize.close();
});

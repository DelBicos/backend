"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn("service", "date", {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: "Data de disponibilidade ou vigência do serviço",
        after: "duration", // ignorado pelo Postgres, funciona no MySQL
      });
    } catch (err) {
      console.log("Coluna date já existe em service, ignorando...");
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("service", "date");
  },
};

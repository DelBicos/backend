"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.addColumn("service", "price_cents", {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "Preço em centavos (inteiro). Tem precedência sobre price.",
      });
    } catch (err) {
      console.log("Coluna price_cents já existe em service, ignorando...");
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("service", "price_cents");
  },
};

"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn("professional", "service_radius_km", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
      });
    } catch (err) {
      console.log("Coluna service_radius_km já existe, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("professional", "service_radius_km");
  },
};

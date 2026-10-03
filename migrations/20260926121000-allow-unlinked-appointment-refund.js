"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("appointment_refund", "appointment_id", {
      type: Sequelize.INTEGER, allowNull: true,
    });
  },
  async down(queryInterface, Sequelize) {
    // Não apagar compensações financeiras para satisfazer NOT NULL.
    // O banco recusa o downgrade se houver estornos sem reserva associada.
    await queryInterface.changeColumn("appointment_refund", "appointment_id", {
      type: Sequelize.INTEGER, allowNull: false,
    });
  },
};

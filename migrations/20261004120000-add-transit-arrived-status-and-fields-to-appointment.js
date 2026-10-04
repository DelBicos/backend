"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      const enumValues = ["in_transit", "arrived", "in_progress"];
      for (const val of enumValues) {
        try {
          await queryInterface.sequelize.query(
            `ALTER TYPE "enum_appointment_status" ADD VALUE IF NOT EXISTS '${val}';`
          );
        } catch (err) {
          console.log(`Valor '${val}' já existe no ENUM ou falhou ao adicionar:`, err.message);
        }
      }
    }

    try {
      await queryInterface.addColumn("appointment", "arrived_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna arrived_at já existe, ignorando...");
    }

    try {
      await queryInterface.addColumn("appointment", "started_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna started_at já existe, ignorando...");
    }

    try {
      await queryInterface.addColumn("appointment", "verification_code", {
        type: Sequelize.STRING(6),
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna verification_code já existe, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeColumn("appointment", "verification_code");
    } catch (err) {}
    try {
      await queryInterface.removeColumn("appointment", "started_at");
    } catch (err) {}
    try {
      await queryInterface.removeColumn("appointment", "arrived_at");
    } catch (err) {}
  },
};

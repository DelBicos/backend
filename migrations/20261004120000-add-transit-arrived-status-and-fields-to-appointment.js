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
        } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }
      }
    }

    try {
      await queryInterface.addColumn("appointment", "arrived_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }

    try {
      await queryInterface.addColumn("appointment", "started_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }

    try {
      await queryInterface.addColumn("appointment", "verification_code", {
        type: Sequelize.STRING(6),
        allowNull: true,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeColumn("appointment", "verification_code");
    } catch {
      // Ja removido.
    }
    try {
      await queryInterface.removeColumn("appointment", "started_at");
    } catch {
      // Ja removido.
    }
    try {
      await queryInterface.removeColumn("appointment", "arrived_at");
    } catch {
      // Ja removido.
    }
  },
};

"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn("appointment", "completed_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna completed_at já existe, ignorando...");
    }

    try {
      await queryInterface.addColumn("appointment", "final_price", {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna final_price já existe, ignorando...");
    }

    // composite index to accelerate provider+status+completed_at queries
    try {
      await queryInterface.addIndex("appointment", [
        "professional_id",
        "status",
        "completed_at",
      ], {
        name: "idx_prof_status_completed_at",
      });
    } catch (err) {
      console.log("Índice idx_prof_status_completed_at já existe, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex("appointment", "idx_prof_status_completed_at");
    await queryInterface.removeColumn("appointment", "final_price");
    await queryInterface.removeColumn("appointment", "completed_at");
  },
};

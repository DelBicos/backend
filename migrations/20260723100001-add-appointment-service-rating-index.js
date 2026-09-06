"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    try {
      await queryInterface.addIndex(
        "appointment",
        ["service_id", "status", "rating"],
        {
          name: "idx_appointment_service_status_rating",
        },
      );
    } catch (err) {
      console.log("Índice idx_appointment_service_status_rating já existe, ignorando...");
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "appointment",
      "idx_appointment_service_status_rating",
    );
  },
};

"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("service_availability", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      service_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "service", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      day_of_week: {
        type: Sequelize.SMALLINT,
        allowNull: false,
        comment: "0=Domingo, 1=Segunda, ..., 6=Sábado",
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: "Horário de início no formato HH:MM:SS",
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: "Horário de término no formato HH:MM:SS",
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    try {
      await queryInterface.addIndex("service_availability", ["service_id"], {
        name: "idx_service_availability_service",
      });
    } catch (err) {
      console.log("Índice idx_service_availability_service já existe, ignorando...");
    }
    try {
      await queryInterface.addIndex(
        "service_availability",
        ["service_id", "day_of_week"],
        { name: "idx_service_availability_service_day" }
      );
    } catch (err) {
      console.log("Índice idx_service_availability_service_day já existe, ignorando...");
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("service_availability");
  },
};

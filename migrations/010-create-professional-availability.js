"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("professional_availability", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      professional_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "professional",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      days_of_week: {
        type: Sequelize.STRING(7),
        defaultValue: "0000000",
      },
      start_day_of_month: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      end_day_of_month: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      start_day: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      end_day: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      is_available: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      recurrence_pattern: {
        type: Sequelize.ENUM("none", "daily", "weekly", "monthly"),
        defaultValue: "none",
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
      await queryInterface.addIndex(
        "professional_availability",
        ["professional_id", "recurrence_pattern", "start_day", "end_day"],
        {
          name: "idx_prof_availability_recurrence",
        }
      );
    } catch (err) {
      console.log("Índice idx_prof_availability_recurrence já existe, ignorando...");
    }
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("professional_availability");
  },
};

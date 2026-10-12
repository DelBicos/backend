"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("appointment_audit_log", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "appointment",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      from_status: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      to_status: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      metadata: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex("appointment_audit_log", ["appointment_id"], {
      name: "idx_appointment_audit_log_appt",
    });
    await queryInterface.addIndex("appointment_audit_log", ["action"], {
      name: "idx_appointment_audit_log_action",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("appointment_audit_log");
  },
};

"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("appointment", {
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
      client_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "client",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      service_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "service",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      address_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "address",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      start_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      end_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "confirmed", "completed", "canceled"),
        defaultValue: "pending",
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      review: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      payment_intent_id: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
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
        "appointment",
        ["professional_id", "start_time", "end_time"],
        {
          name: "idx_appointment_times",
        }
      );
    } catch (err) {
      console.log("Índice idx_appointment_times já existe, ignorando...");
    }
    try {
      await queryInterface.addIndex("appointment", ["status", "start_time"], {
        name: "idx_appointment_status_check",
      });
    } catch (err) {
      console.log("Índice idx_appointment_status_check já existe, ignorando...");
    }
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("appointment");
  },
};

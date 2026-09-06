"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("chat_room", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: "appointment", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      professional_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "professional", key: "id" },
      },
      client_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "client", key: "id" },
      },
      service_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "service", key: "id" },
      },
      status: {
        type: Sequelize.ENUM("active", "archived"),
        defaultValue: "active",
      },
      last_message_preview: {
        type: Sequelize.STRING(280),
        allowNull: true,
      },
      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_sender_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    try {
      await queryInterface.addIndex(
        "chat_room",
        ["professional_id", "last_message_at"],
        { name: "idx_chat_room_professional" }
      );
    } catch (err) {
      console.log("Índice idx_chat_room_professional já existe, ignorando...");
    }

    try {
      await queryInterface.addIndex(
        "chat_room",
        ["client_id", "last_message_at"],
        { name: "idx_chat_room_client" }
      );
    } catch (err) {
      console.log("Índice idx_chat_room_client já existe, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex("chat_room", "idx_chat_room_client");
    await queryInterface.removeIndex("chat_room", "idx_chat_room_professional");
    await queryInterface.dropTable("chat_room");
    // Remove o tipo ENUM gerado pelo Postgres
    if (queryInterface.sequelize.getDialect() === "postgres") {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_chat_room_status";'
      );
    }
  },
};

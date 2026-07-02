"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("bot_chat_session", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      channel: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: "web",
      },
      status: {
        type: Sequelize.ENUM("active", "completed", "abandoned"),
        allowNull: false,
        defaultValue: "active",
      },
      state: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: "INICIO",
        comment:
          "Estado atual da máquina de conversa (INICIO, COLETANDO_SERVICO, COLETANDO_DATA, etc.)",
      },
      context: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Entidades coletadas durante a conversa (serviceId, date, time, etc.)",
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "appointment", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Agendamento criado/manipulado por esta sessão",
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      ended_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex("bot_chat_session", ["user_id"], {
      name: "idx_bot_session_user_id",
    });
    await queryInterface.addIndex("bot_chat_session", ["status"], {
      name: "idx_bot_session_status",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("bot_chat_session", "idx_bot_session_status");
    await queryInterface.removeIndex("bot_chat_session", "idx_bot_session_user_id");
    await queryInterface.dropTable("bot_chat_session");
  },
};

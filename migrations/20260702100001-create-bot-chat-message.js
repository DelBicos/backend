"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("bot_chat_message", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "bot_chat_session", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      sender: {
        type: Sequelize.ENUM("user", "bot"),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      intent: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Intenção NLU detectada nesta mensagem (apenas para mensagens do usuário)",
      },
      entities: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Entidades extraídas pelo NLU nesta mensagem",
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

    await queryInterface.addIndex("bot_chat_message", ["session_id"], {
      name: "idx_bot_message_session_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("bot_chat_message", "idx_bot_message_session_id");
    await queryInterface.dropTable("bot_chat_message");
  },
};

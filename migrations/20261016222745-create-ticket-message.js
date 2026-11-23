"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ticket_message", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "ticket", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      author_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      author_type: {
        type: Sequelize.ENUM("CLIENTE", "PRESTADOR", "ADMIN"),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      attachment_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
        defaultValue: null,
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

    await queryInterface.addIndex("ticket_message", ["ticket_id"], {
      name: "idx_ticket_message_ticket",
    });
    await queryInterface.addIndex("ticket_message", ["created_at"], {
      name: "idx_ticket_message_created",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ticket_message");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_message_author_type";'
    );
  },
};
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

    // In development, sequelize.sync() may have created these indexes from the model already.
    const existingIndexes = (await queryInterface.showIndex("ticket_message")).map(
      (index) => index.name,
    );
    const indexes = [
      { name: "idx_ticket_message_ticket", fields: ["ticket_id"] },
      { name: "idx_ticket_message_created", fields: ["created_at"] },
    ];
    for (const { name, fields } of indexes) {
      if (!existingIndexes.includes(name)) {
        await queryInterface.addIndex("ticket_message", fields, { name });
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ticket_message");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_message_author_type";'
    );
  },
};
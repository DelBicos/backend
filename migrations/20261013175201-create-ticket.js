// src/migrations/20261013120000-create-ticket.js
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ticket", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_code: {
        type: Sequelize.STRING(10),
        allowNull: false,
        unique: true,
      },
      title: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      category: {
        type: Sequelize.ENUM(
          "AGENDAMENTO",
          "PAGAMENTO",
          "SERVICO",
          "PRESTADOR",
          "CLIENTE",
          "SUGESTAO",
          "OUTROS"
        ),
        allowNull: false,
      },
      priority: {
        type: Sequelize.ENUM("BAIXA", "MEDIA", "ALTA", "CRITICA"),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(
          "ABERTO",
          "EM_ANALISE",
          "EM_ATENDIMENTO",
          "RESOLVIDO",
          "FECHADO"
        ),
        allowNull: false,
        defaultValue: "ABERTO",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      user_type: {
        type: Sequelize.ENUM("CLIENTE", "PRESTADOR"),
        allowNull: false,
      },
      admin_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "appointment", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
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

    await queryInterface.addIndex("ticket", ["user_id"], {
      name: "idx_ticket_user",
    });
    await queryInterface.addIndex("ticket", ["status"], {
      name: "idx_ticket_status",
    });
    await queryInterface.addIndex("ticket", ["priority", "status"], {
      name: "idx_ticket_priority_status",
    });
    await queryInterface.addIndex("ticket", ["created_at"], {
      name: "idx_ticket_created_at",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ticket");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_category";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_priority";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_status";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ticket_user_type";'
    );
  },
};
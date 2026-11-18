"use strict";

/**
 * Ciclo de vida do agendamento: cancelamento com politica, nao comparecimento,
 * reagendamento e disputas.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // Novo valor no enum de status.
    if (dialect === "postgres") {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_appointment_status" ADD VALUE IF NOT EXISTS 'no_show'`,
      );
    } else {
      await queryInterface.changeColumn("appointment", "status", {
        type: Sequelize.ENUM("pending", "confirmed", "completed", "canceled", "no_show"),
        defaultValue: "pending",
      });
    }

    const columns = {
      canceled_by: { type: Sequelize.ENUM("client", "professional", "system"), allowNull: true },
      canceled_at: { type: Sequelize.DATE, allowNull: true },
      cancellation_reason: { type: Sequelize.STRING(500), allowNull: true },
      retained_cents: { type: Sequelize.INTEGER, allowNull: true },
      refunded_cents: { type: Sequelize.INTEGER, allowNull: true },
      reschedule_requested_start: { type: Sequelize.DATE, allowNull: true },
      reschedule_requested_by: { type: Sequelize.ENUM("client", "professional"), allowNull: true },
    };
    const existing = await queryInterface.describeTable("appointment");
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing[name]) await queryInterface.addColumn("appointment", name, definition);
    }

    const professional = await queryInterface.describeTable("professional");
    if (!professional.cancellations_count) {
      await queryInterface.addColumn("professional", "cancellations_count", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    await queryInterface.createTable("dispute", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: "appointment", key: "id" },
        onDelete: "CASCADE",
      },
      opened_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      reason: { type: Sequelize.STRING(40), allowNull: false },
      description: { type: Sequelize.STRING(1000), allowNull: false },
      status: {
        type: Sequelize.ENUM("open", "resolved"),
        allowNull: false,
        defaultValue: "open",
      },
      resolution: { type: Sequelize.STRING(20), allowNull: true },
      refund_cents: { type: Sequelize.INTEGER, allowNull: true },
      resolution_note: { type: Sequelize.STRING(1000), allowNull: true },
      resolved_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("dispute", ["status", "created_at"], {
      name: "idx_dispute_status",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("dispute");
    await queryInterface.removeColumn("professional", "cancellations_count");
    for (const name of [
      "reschedule_requested_by",
      "reschedule_requested_start",
      "refunded_cents",
      "retained_cents",
      "cancellation_reason",
      "canceled_at",
      "canceled_by",
    ]) {
      await queryInterface.removeColumn("appointment", name);
    }
    // O valor 'no_show' do enum nao e removido (Postgres nao suporta).
  },
};

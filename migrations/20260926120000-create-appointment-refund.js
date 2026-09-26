"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("appointment_refund", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      appointment_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: "appointment", key: "id" },
        onDelete: "RESTRICT", onUpdate: "CASCADE",
      },
      payment_intent_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "pending" },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      next_attempt_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("appointment_refund", ["status", "next_attempt_at"], {
      name: "idx_appointment_refund_due",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("appointment_refund");
  },
};

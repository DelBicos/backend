"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("cancellation_verification", {
      user_id: { type: Sequelize.INTEGER, primaryKey: true, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      appointment_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: "appointment", key: "id" }, onDelete: "CASCADE" },
      challenge_id: { type: Sequelize.UUID, allowNull: false, unique: true },
      email: { type: Sequelize.STRING, allowNull: false },
      code_hash: { type: Sequelize.STRING(64), allowNull: false },
      salt: { type: Sequelize.STRING(32), allowNull: false },
      attempts: { type: Sequelize.INTEGER, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      last_sent_at: { type: Sequelize.DATE, allowNull: false },
      window_started_at: { type: Sequelize.DATE, allowNull: false },
      send_count: { type: Sequelize.INTEGER, allowNull: false },
      consumed: { type: Sequelize.BOOLEAN, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("cancellation_verification");
  },
};

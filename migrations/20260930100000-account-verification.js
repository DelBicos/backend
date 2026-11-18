"use strict";

/**
 * Verificacao de conta: MFA por e-mail (users.mfa_enabled), selo de
 * profissional verificado (professional.identity_verified_at) e a tabela de
 * pedidos de verificacao de identidade revisados por um administrador.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable("users");
    if (!users.mfa_enabled) {
      await queryInterface.addColumn("users", "mfa_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    const professional = await queryInterface.describeTable("professional");
    if (!professional.identity_verified_at) {
      await queryInterface.addColumn("professional", "identity_verified_at", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const tables = await queryInterface.showAllTables();
    if (!tables.includes("identity_verification")) {
      await queryInterface.createTable("identity_verification", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        professional_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "professional", key: "id" },
          onDelete: "CASCADE",
        },
        document_type: { type: Sequelize.STRING(10), allowNull: false },
        front_key: { type: Sequelize.STRING(255), allowNull: true },
        back_key: { type: Sequelize.STRING(255), allowNull: true },
        selfie_key: { type: Sequelize.STRING(255), allowNull: true },
        status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "pending" },
        reject_reason: { type: Sequelize.STRING(500), allowNull: true },
        reviewed_by_user_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: "users", key: "id" },
        },
        reviewed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      });
      await queryInterface.addIndex("identity_verification", ["professional_id", "status"], {
        name: "idx_identity_verification_professional_status",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("identity_verification");
    await queryInterface.removeColumn("professional", "identity_verified_at");
    await queryInterface.removeColumn("users", "mfa_enabled");
  },
};

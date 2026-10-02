"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn("service", "category_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "category", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    } catch (err) {
      console.log("Coluna category_id já existe em service, ignorando...");
    }

    try {
      await queryInterface.addIndex("service", ["category_id"], {
        name: "idx_service_category",
      });
    } catch (err) {
      console.log("Índice idx_service_category já existe, ignorando...");
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("service", "idx_service_category");
    await queryInterface.removeColumn("service", "category_id");
  },
};

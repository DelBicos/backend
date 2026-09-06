"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.addColumn("professional_availability_lock", "reason", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna reason já existe, ignorando...");
    }
    try {
      await queryInterface.addColumn("professional_availability_lock", "created_by", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    } catch (err) {
      console.log("Coluna created_by já existe, ignorando...");
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("professional_availability_lock", "created_by");
    await queryInterface.removeColumn("professional_availability_lock", "reason");
  },
};

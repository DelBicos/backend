"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("professional_amenities", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      professional_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "professional",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      amenity_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "amenities",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
    });

    try {
      await queryInterface.addIndex(
        "professional_amenities",
        ["professional_id", "amenity_id"],
        {
          unique: true,
          name: "idx_unique_professional_amenity",
        }
      );
    } catch (err) {
      console.log("Índice idx_unique_professional_amenity já existe, ignorando...");
    }
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("professional_amenities");
  },
};

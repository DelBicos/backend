"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("favorites", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    try {
      await queryInterface.addConstraint("favorites", {
        fields: ["user_id", "professional_id"],
        type: "unique",
        name: "unique_user_professional_favorite",
      });
    } catch (err) {
      console.log("Constraint unique_user_professional_favorite já existe, ignorando...");
    }

    try {
      await queryInterface.addIndex("favorites", ["user_id"], {
        name: "idx_user_favorites",
      });
    } catch (err) {
      console.log("Índice idx_user_favorites já existe, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("favorites");
  },
};

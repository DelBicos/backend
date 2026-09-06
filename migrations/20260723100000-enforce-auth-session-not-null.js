"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.sequelize.query(
        "UPDATE bot_chat_session " +
          "SET auth_session_id = CONCAT('user:', user_id) " +
          "WHERE auth_session_id IS NULL",
      );

      await queryInterface.changeColumn(
        "bot_chat_session",
        "auth_session_id",
        {
          type: Sequelize.STRING(64),
          allowNull: false,
        },
      );
    } catch (err) {
      console.log("Alteração de auth_session_id para NOT NULL já aplicada, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn(
      "bot_chat_session",
      "auth_session_id",
      {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
    );
  },
};

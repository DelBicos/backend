"use strict";

/** Scope bot conversations to the JWT login that created them. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("bot_chat_session", "auth_session_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    // Existing records have no trustworthy login identifier; do not restore them.
    await queryInterface.sequelize.query(
      "UPDATE bot_chat_session SET status = 'abandoned', ended_at = CURRENT_TIMESTAMP WHERE status = 'active'"
    );

    await queryInterface.addIndex("bot_chat_session", ["user_id", "auth_session_id", "status"], {
      name: "idx_bot_session_auth_scope",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("bot_chat_session", "idx_bot_session_auth_scope");
    await queryInterface.removeColumn("bot_chat_session", "auth_session_id");
  },
};

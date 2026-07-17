"use strict";

/** Bot conversations survive refreshes and new JWT logins for the same user. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex(
      "bot_chat_session",
      "idx_bot_session_auth_scope",
    );
    await queryInterface.addIndex(
      "bot_chat_session",
      ["user_id", "status", "channel"],
      { name: "idx_bot_session_user_scope" },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "bot_chat_session",
      "idx_bot_session_user_scope",
    );
    await queryInterface.addIndex(
      "bot_chat_session",
      ["user_id", "auth_session_id", "status"],
      { name: "idx_bot_session_auth_scope" },
    );
  },
};

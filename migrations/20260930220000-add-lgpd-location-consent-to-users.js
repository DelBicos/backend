'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('users', 'location_consent_accepted', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }

    try {
      await queryInterface.addColumn('users', 'location_consent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }

    try {
      await queryInterface.addColumn('users', 'location_consent_revoked_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch {
      // Ja existe (migration reaplicada): segue sem erro.
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeColumn('users', 'location_consent_accepted');
    } catch {
      // Ja removido.
    }
    try {
      await queryInterface.removeColumn('users', 'location_consent_at');
    } catch {
      // Ja removido.
    }
    try {
      await queryInterface.removeColumn('users', 'location_consent_revoked_at');
    } catch {
      // Ja removido.
    }
  },
};

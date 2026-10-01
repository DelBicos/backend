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
    } catch (err) {
      console.log('Coluna location_consent_accepted já existe em users, ignorando...');
    }

    try {
      await queryInterface.addColumn('users', 'location_consent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch (err) {
      console.log('Coluna location_consent_at já existe em users, ignorando...');
    }

    try {
      await queryInterface.addColumn('users', 'location_consent_revoked_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } catch (err) {
      console.log('Coluna location_consent_revoked_at já existe em users, ignorando...');
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeColumn('users', 'location_consent_accepted');
    } catch (err) {}
    try {
      await queryInterface.removeColumn('users', 'location_consent_at');
    } catch (err) {}
    try {
      await queryInterface.removeColumn('users', 'location_consent_revoked_at');
    } catch (err) {}
  },
};

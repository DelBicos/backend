'use strict';

const { customAlphabet } = require('nanoid');

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateShortId = customAlphabet(alphabet, 6);

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('appointment', 'short_id', {
        type: Sequelize.STRING(6),
        allowNull: true,
      });
    } catch (err) {
      console.log('Coluna short_id já existe em appointment, ignorando...');
    }

    const appointments = await queryInterface.sequelize.query(
      'SELECT id FROM appointment WHERE short_id IS NULL',
      { type: Sequelize.QueryTypes.SELECT }
    );

    const usedIds = new Set();
    for (const row of appointments) {
      let shortId;
      let attempts = 0;
      do {
        shortId = generateShortId();
        attempts++;
        if (attempts > 100) throw new Error('Não foi possível gerar short_id único após 100 tentativas');
      } while (
        usedIds.has(shortId) ||
        (await queryInterface.sequelize.query(
          'SELECT 1 FROM appointment WHERE short_id = :shortId',
          { replacements: { shortId }, type: Sequelize.QueryTypes.SELECT }
        )).length > 0
      );
      usedIds.add(shortId);
      await queryInterface.sequelize.query(
        'UPDATE appointment SET short_id = :shortId WHERE id = :id',
        { replacements: { shortId, id: row.id } }
      );
    }

    try {
      await queryInterface.changeColumn('appointment', 'short_id', {
        type: Sequelize.STRING(6),
        allowNull: false,
      });
    } catch (err) {
      console.log('Alteração de coluna short_id ignorada...');
    }

    try {
      await queryInterface.addConstraint('appointment', {
        fields: ['short_id'],
        type: 'unique',
        name: 'unique_appointment_short_id'
      });
    } catch (err) {
      console.log('Constraint unique_appointment_short_id já existe, ignorando...');
    }

    try {
      await queryInterface.addIndex('appointment', ['short_id'], {
        name: 'idx_appointment_short_id'
      });
    } catch (err) {
      console.log('Índice idx_appointment_short_id já existe, ignorando...');
    }
  },

  async down (queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex('appointment', 'idx_appointment_short_id');
    } catch (err) {}
    try {
      await queryInterface.removeConstraint('appointment', 'unique_appointment_short_id');
    } catch (err) {}
    try {
      await queryInterface.removeColumn('appointment', 'short_id');
    } catch (err) {}
  }
};
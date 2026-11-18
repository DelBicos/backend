"use strict";

/**
 * Gera o codigo de inicio (formato AB-12) para agendamentos ativos que ficaram sem
 * ele: os criados por seeders ou antes da coluna existir nao passam pelo hook do model.
 * Idempotente: so preenche quem esta com o codigo vazio.
 */
const crypto = require("crypto");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const randomCode = () =>
  `${LETTERS[crypto.randomInt(0, 26)]}${LETTERS[crypto.randomInt(0, 26)]}-${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}`;

module.exports = {
  async up(queryInterface) {
    const pending = await queryInterface.sequelize.query(
      `SELECT id FROM appointment
        WHERE verification_code IS NULL
          AND status NOT IN ('completed', 'canceled', 'no_show')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    if (pending.length === 0) return;

    const used = new Set(
      (
        await queryInterface.sequelize.query(
          `SELECT verification_code FROM appointment
            WHERE verification_code IS NOT NULL
              AND status NOT IN ('completed', 'canceled', 'no_show')`,
          { type: queryInterface.sequelize.QueryTypes.SELECT },
        )
      ).map((row) => row.verification_code),
    );

    for (const { id } of pending) {
      let code = randomCode();
      for (let attempt = 0; used.has(code) && attempt < 100; attempt++) code = randomCode();
      used.add(code);
      await queryInterface.sequelize.query(
        "UPDATE appointment SET verification_code = :code WHERE id = :id AND verification_code IS NULL",
        { replacements: { code, id } },
      );
    }
  },

  async down() {
    // Nada a desfazer: os codigos gerados continuam validos.
  },
};

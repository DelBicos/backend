"use strict";

/**
 * Agenda geral dos sete profissionais iniciais.
 *
 * A posição do caractere em days_of_week representa 0=domingo até 6=sábado.
 * As regras acompanham os horários dos serviços iniciais e são localizadas por
 * e-mail, sem depender da ordem ou do ID dos profissionais.
 */
const INITIAL_PROFESSIONAL_SCHEDULES = [
  {
    email: "fernando@delbicos.com.br",
    rules: [
      { days: "0111110", start: "09:00:00", end: "18:00:00" },
      { days: "0000001", start: "09:00:00", end: "13:00:00" },
      { days: "1111111", start: "18:00:00", end: "22:00:00" },
    ],
  },
  {
    email: "isabel@delbicos.com.br",
    rules: [{ days: "0010100", start: "13:00:00", end: "18:00:00" }],
  },
  {
    email: "douglas@delbicos.com.br",
    rules: [{ days: "0111110", start: "09:00:00", end: "17:00:00" }],
  },
  {
    email: "gustavo@delbicos.com.br",
    rules: [{ days: "0000001", start: "08:00:00", end: "16:00:00" }],
  },
  {
    email: "eduardo@delbicos.com.br",
    rules: [
      { days: "0101000", start: "07:00:00", end: "11:00:00" },
      { days: "0101000", start: "14:00:00", end: "18:00:00" },
    ],
  },
  {
    email: "iago@delbicos.com.br",
    rules: [{ days: "0111111", start: "08:00:00", end: "19:00:00" }],
  },
  {
    email: "lucas@delbicos.com.br",
    rules: [{ days: "1000001", start: "10:00:00", end: "15:00:00" }],
  },
];

function normalizeTime(value) {
  if (value == null) return "";
  const text = String(value);
  return /^\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
}

function ruleKey(professionalId, days, start, end) {
  return (
    `${professionalId}|${days}|${normalizeTime(start)}|` + normalizeTime(end)
  );
}

async function selectRows(
  queryInterface,
  Sequelize,
  sql,
  replacements,
  transaction,
) {
  return queryInterface.sequelize.query(sql, {
    replacements,
    type: Sequelize.QueryTypes.SELECT,
    transaction,
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const emails = INITIAL_PROFESSIONAL_SCHEDULES.map(
        (schedule) => schedule.email,
      );
      const professionals = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT p.id AS professional_id, u.email
         FROM professional p
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const professionalByEmail = new Map(
        professionals.map((row) => [row.email, Number(row.professional_id)]),
      );
      const missingEmails = emails.filter(
        (email) => !professionalByEmail.has(email),
      );
      if (missingEmails.length > 0) {
        console.warn(
          `Profissionais iniciais não encontrados: ${missingEmails.join(", ")}.`,
        );
      }

      const professionalIds = [...professionalByEmail.values()];
      if (professionalIds.length === 0) return;
      const existing = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT professional_id, days_of_week, start_time, end_time
         FROM professional_availability
         WHERE professional_id IN (:professionalIds)
           AND recurrence_pattern = 'weekly'
           AND is_available = true`,
        { professionalIds },
        transaction,
      );
      const existingKeys = new Set(
        existing.map((row) =>
          ruleKey(
            Number(row.professional_id),
            row.days_of_week,
            row.start_time,
            row.end_time,
          ),
        ),
      );
      const now = new Date();
      const rows = INITIAL_PROFESSIONAL_SCHEDULES.flatMap((schedule) => {
        const professionalId = professionalByEmail.get(schedule.email);
        if (!professionalId) return [];
        return schedule.rules.flatMap((rule) => {
          const key = ruleKey(
            professionalId,
            rule.days,
            rule.start,
            rule.end,
          );
          if (existingKeys.has(key)) return [];
          existingKeys.add(key);
          return [
            {
              professional_id: professionalId,
              days_of_week: rule.days,
              start_time: rule.start,
              end_time: rule.end,
              recurrence_pattern: "weekly",
              is_available: true,
              created_at: now,
              updated_at: now,
            },
          ];
        });
      });

      if (rows.length > 0) {
        await queryInterface.bulkInsert("professional_availability", rows, {
          transaction,
        });
      }
      console.log(`Regras gerais de agenda criadas: ${rows.length}.`);
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const emails = INITIAL_PROFESSIONAL_SCHEDULES.map(
        (schedule) => schedule.email,
      );
      const professionals = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT p.id AS professional_id, u.email
         FROM professional p
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const professionalByEmail = new Map(
        professionals.map((row) => [row.email, Number(row.professional_id)]),
      );

      for (const schedule of INITIAL_PROFESSIONAL_SCHEDULES) {
        const professionalId = professionalByEmail.get(schedule.email);
        if (!professionalId) continue;
        for (const rule of schedule.rules) {
          await queryInterface.bulkDelete(
            "professional_availability",
            {
              professional_id: professionalId,
              days_of_week: rule.days,
              start_time: rule.start,
              end_time: rule.end,
              recurrence_pattern: "weekly",
              is_available: true,
            },
            { transaction },
          );
        }
      }
    });
  },
};

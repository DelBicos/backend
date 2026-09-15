"use strict";

/**
 * Completa as agendas dos profissionais criados pelos seeders 009 e 010.
 *
 * O seeder é idempotente: localiza profissionais por e-mail e insere apenas as
 * regras semanais e disponibilidades de serviço que ainda não existem. Não usa
 * IDs fixos, pois eles podem variar entre bancos locais.
 */

const DEMO_SCHEDULES = [
  {
    email: "carlos.silva@delbicos.com",
    start: "08:00:00",
    end: "18:00:00",
  },
  {
    email: "maria.costa@delbicos.com",
    start: "08:00:00",
    end: "18:00:00",
  },
  {
    email: "joao.oliveira@delbicos.com",
    start: "08:00:00",
    end: "18:00:00",
  },
  {
    email: "ana.rodrigues@delbicos.com",
    start: "09:00:00",
    end: "19:00:00",
  },
  {
    email: "ricardo.souza@delbicos.com",
    start: "07:00:00",
    end: "19:00:00",
  },
  {
    email: "patricia.lima@delbicos.com",
    start: "09:00:00",
    end: "19:00:00",
  },
  {
    email: "fernando.dias@delbicos.com",
    start: "07:00:00",
    end: "18:00:00",
  },
  {
    email: "juliana.martins@delbicos.com",
    start: "08:00:00",
    end: "18:00:00",
  },
];

// 0=domingo, 1=segunda, ..., 6=sábado. Domingo permanece sem atendimento.
const WORK_DAYS = [1, 2, 3, 4, 5, 6];
const WEEKLY_MASK = "0111111";

function normalizeTime(value) {
  if (value == null) return "";
  const text = String(value);
  return /^\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
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
      const now = new Date();
      const emails = DEMO_SCHEDULES.map((schedule) => schedule.email);
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
          `Profissionais demonstrativos não encontrados: ${missingEmails.join(", ")}`,
        );
      }

      const professionalIds = [...professionalByEmail.values()];
      if (professionalIds.length === 0) {
        console.warn("Nenhuma disponibilidade demonstrativa foi criada.");
        return;
      }

      const existingProfessionalRules = await selectRows(
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
      const existingProfessionalKeys = new Set(
        existingProfessionalRules.map(
          (row) =>
            `${row.professional_id}|${row.days_of_week}|` +
            `${normalizeTime(row.start_time)}|${normalizeTime(row.end_time)}`,
        ),
      );

      const professionalAvailabilityRows = DEMO_SCHEDULES.flatMap(
        (schedule) => {
          const professionalId = professionalByEmail.get(schedule.email);
          if (!professionalId) return [];
          const key =
            `${professionalId}|${WEEKLY_MASK}|${schedule.start}|${schedule.end}`;
          if (existingProfessionalKeys.has(key)) return [];
          return [
            {
              professional_id: professionalId,
              days_of_week: WEEKLY_MASK,
              start_time: schedule.start,
              end_time: schedule.end,
              recurrence_pattern: "weekly",
              is_available: true,
              created_at: now,
              updated_at: now,
            },
          ];
        },
      );

      if (professionalAvailabilityRows.length > 0) {
        await queryInterface.bulkInsert(
          "professional_availability",
          professionalAvailabilityRows,
          { transaction },
        );
      }

      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id AS service_id, s.professional_id, u.email
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         WHERE s.active = true
           AND u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const serviceIds = services.map((row) => Number(row.service_id));
      if (serviceIds.length === 0) {
        console.warn("Nenhum serviço demonstrativo ativo foi encontrado.");
        return;
      }

      const existingServiceRules = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT service_id, day_of_week, start_time, end_time
         FROM service_availability
         WHERE service_id IN (:serviceIds)`,
        { serviceIds },
        transaction,
      );
      const existingServiceKeys = new Set(
        existingServiceRules.map(
          (row) =>
            `${row.service_id}|${row.day_of_week}|` +
            `${normalizeTime(row.start_time)}|${normalizeTime(row.end_time)}`,
        ),
      );
      const scheduleByEmail = new Map(
        DEMO_SCHEDULES.map((schedule) => [schedule.email, schedule]),
      );

      const serviceAvailabilityRows = services.flatMap((service) => {
        const schedule = scheduleByEmail.get(service.email);
        if (!schedule) return [];
        return WORK_DAYS.flatMap((day) => {
          const key =
            `${service.service_id}|${day}|${schedule.start}|${schedule.end}`;
          if (existingServiceKeys.has(key)) return [];
          return [
            {
              service_id: Number(service.service_id),
              day_of_week: day,
              start_time: schedule.start,
              end_time: schedule.end,
              created_at: now,
              updated_at: now,
            },
          ];
        });
      });

      if (serviceAvailabilityRows.length > 0) {
        await queryInterface.bulkInsert(
          "service_availability",
          serviceAvailabilityRows,
          { transaction },
        );
      }

      console.log(
        `Disponibilidades demonstrativas: ${professionalAvailabilityRows.length} ` +
          `regras profissionais e ${serviceAvailabilityRows.length} regras de serviço criadas.`,
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const emails = DEMO_SCHEDULES.map((schedule) => schedule.email);
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
      if (professionals.length === 0) return;

      const professionalByEmail = new Map(
        professionals.map((row) => [row.email, Number(row.professional_id)]),
      );
      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id AS service_id, u.email
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );

      for (const schedule of DEMO_SCHEDULES) {
        const professionalId = professionalByEmail.get(schedule.email);
        if (!professionalId) continue;
        await queryInterface.bulkDelete(
          "professional_availability",
          {
            professional_id: professionalId,
            days_of_week: WEEKLY_MASK,
            start_time: schedule.start,
            end_time: schedule.end,
            recurrence_pattern: "weekly",
            is_available: true,
          },
          { transaction },
        );
      }

      for (const service of services) {
        const schedule = DEMO_SCHEDULES.find(
          (item) => item.email === service.email,
        );
        if (!schedule) continue;
        await queryInterface.bulkDelete(
          "service_availability",
          {
            service_id: Number(service.service_id),
            day_of_week: { [Sequelize.Op.in]: WORK_DAYS },
            start_time: schedule.start,
            end_time: schedule.end,
          },
          { transaction },
        );
      }
    });
  },
};

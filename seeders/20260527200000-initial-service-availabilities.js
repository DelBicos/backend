"use strict";

/**
 * Disponibilidades dos serviços iniciais do seeder 007.
 *
 * Os serviços são localizados pela chave estável e-mail + título. Isso evita
 * associar horários ao serviço errado quando os IDs mudam ou outros registros
 * são inseridos antes deles. A execução é idempotente.
 */
const INITIAL_SERVICE_SCHEDULES = [
  {
    email: "fernando@delbicos.com.br",
    title: "Abertura de Fechaduras",
    slots: [
      { day: 1, start: "08:00:00", end: "12:00:00" },
      { day: 3, start: "08:00:00", end: "12:00:00" },
      { day: 5, start: "08:00:00", end: "12:00:00" },
    ],
  },
  {
    email: "isabel@delbicos.com.br",
    title: "Instalação de Tomadas",
    slots: [
      { day: 2, start: "13:00:00", end: "18:00:00" },
      { day: 4, start: "13:00:00", end: "18:00:00" },
    ],
  },
  {
    email: "douglas@delbicos.com.br",
    title: "Desentupimento de Pia",
    slots: [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: "09:00:00",
      end: "17:00:00",
    })),
  },
  {
    email: "gustavo@delbicos.com.br",
    title: "Instalação de Aquecedor a Gás",
    slots: [{ day: 6, start: "08:00:00", end: "16:00:00" }],
  },
  {
    email: "eduardo@delbicos.com.br",
    title: "Limpeza Completa pós Reforma",
    slots: [
      { day: 1, start: "07:00:00", end: "11:00:00" },
      { day: 1, start: "14:00:00", end: "18:00:00" },
      { day: 3, start: "07:00:00", end: "11:00:00" },
      { day: 3, start: "14:00:00", end: "18:00:00" },
    ],
  },
  {
    email: "iago@delbicos.com.br",
    title: "Montagem de Móveis",
    slots: [1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      start: "08:00:00",
      end: "19:00:00",
    })),
  },
  {
    email: "lucas@delbicos.com.br",
    title: "Móveis sob Medida",
    slots: [0, 6].map((day) => ({
      day,
      start: "10:00:00",
      end: "15:00:00",
    })),
  },
];

function normalizeTime(value) {
  if (value == null) return "";
  const text = String(value);
  return /^\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
}

function availabilityKey(serviceId, slot) {
  return (
    `${serviceId}|${slot.day}|` +
    `${normalizeTime(slot.start)}|${normalizeTime(slot.end)}`
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
      const emails = INITIAL_SERVICE_SCHEDULES.map((item) => item.email);
      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id AS service_id, s.title, u.email
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const serviceByPair = new Map(
        services.map((service) => [
          `${service.email}|${service.title}`,
          Number(service.service_id),
        ]),
      );
      const serviceIds = [...serviceByPair.values()];
      if (serviceIds.length === 0) {
        console.warn("Nenhum serviço inicial foi encontrado para criar horários.");
        return;
      }

      const existing = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT service_id, day_of_week, start_time, end_time
         FROM service_availability
         WHERE service_id IN (:serviceIds)`,
        { serviceIds },
        transaction,
      );
      const existingKeys = new Set(
        existing.map((row) =>
          availabilityKey(Number(row.service_id), {
            day: Number(row.day_of_week),
            start: row.start_time,
            end: row.end_time,
          }),
        ),
      );
      const now = new Date();
      const rows = INITIAL_SERVICE_SCHEDULES.flatMap((schedule) => {
        const serviceId = serviceByPair.get(
          `${schedule.email}|${schedule.title}`,
        );
        if (!serviceId) {
          console.warn(
            `Serviço "${schedule.title}" de ${schedule.email} não encontrado.`,
          );
          return [];
        }

        return schedule.slots.flatMap((slot) => {
          const key = availabilityKey(serviceId, slot);
          if (existingKeys.has(key)) return [];
          existingKeys.add(key);
          return [
            {
              service_id: serviceId,
              day_of_week: slot.day,
              start_time: slot.start,
              end_time: slot.end,
              created_at: now,
              updated_at: now,
            },
          ];
        });
      });

      if (rows.length > 0) {
        await queryInterface.bulkInsert("service_availability", rows, {
          transaction,
        });
      }
      console.log(`Horários dos serviços iniciais criados: ${rows.length}.`);
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const emails = INITIAL_SERVICE_SCHEDULES.map((item) => item.email);
      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id AS service_id, s.title, u.email
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const serviceByPair = new Map(
        services.map((service) => [
          `${service.email}|${service.title}`,
          Number(service.service_id),
        ]),
      );

      for (const schedule of INITIAL_SERVICE_SCHEDULES) {
        const serviceId = serviceByPair.get(
          `${schedule.email}|${schedule.title}`,
        );
        if (!serviceId) continue;
        for (const slot of schedule.slots) {
          await queryInterface.bulkDelete(
            "service_availability",
            {
              service_id: serviceId,
              day_of_week: slot.day,
              start_time: slot.start,
              end_time: slot.end,
            },
            { transaction },
          );
        }
      }
    });
  },
};

"use strict";

const INITIAL_SERVICES = [
  {
    email: "fernando@delbicos.com.br",
    title: "Abertura de Fechaduras",
    price: 80,
    duration: 30,
    subcategory: "Chaveiro",
  },
  {
    email: "isabel@delbicos.com.br",
    title: "Instalação de Tomadas",
    price: 50,
    duration: 45,
    subcategory: "Eletricista",
  },
  {
    email: "douglas@delbicos.com.br",
    title: "Desentupimento de Pia",
    price: 100,
    duration: 60,
    subcategory: "Encanador",
  },
  {
    email: "gustavo@delbicos.com.br",
    title: "Instalação de Aquecedor a Gás",
    price: 200,
    duration: 120,
    subcategory: "Gás & Água",
  },
  {
    email: "eduardo@delbicos.com.br",
    title: "Limpeza Completa pós Reforma",
    price: 300,
    duration: 240,
    subcategory: "Limpeza pós Obra",
  },
  {
    email: "iago@delbicos.com.br",
    title: "Montagem de Móveis",
    price: 80,
    duration: 120,
    subcategory: "Marido de Aluguel",
  },
  {
    email: "lucas@delbicos.com.br",
    title: "Móveis sob Medida",
    price: 500,
    duration: 480,
    subcategory: "Marceneiro",
  },
];

function serviceKey(professionalId, title) {
  return `${professionalId}|${title}`;
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

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const emails = INITIAL_SERVICES.map((service) => service.email);
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

      const subcategories = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT sc.id, sc.title
         FROM subcategory sc
         INNER JOIN category c ON c.id = sc.category_id
         WHERE c.title = :categoryTitle`,
        { categoryTitle: "Reformas & Reparos" },
        transaction,
      );
      const subcategoryByTitle = new Map(
        subcategories.map((row) => [row.title, Number(row.id)]),
      );

      const professionalIds = professionals.map((row) =>
        Number(row.professional_id),
      );
      const existingServices =
        professionalIds.length === 0
          ? []
          : await selectRows(
              queryInterface,
              Sequelize,
              `SELECT professional_id, title
               FROM service
               WHERE professional_id IN (:professionalIds)`,
              { professionalIds },
              transaction,
            );
      const existingKeys = new Set(
        existingServices.map((row) =>
          serviceKey(Number(row.professional_id), row.title),
        ),
      );

      const rows = INITIAL_SERVICES.flatMap((service) => {
        const professionalId = professionalByEmail.get(service.email);
        const subcategoryId = subcategoryByTitle.get(service.subcategory);
        if (!professionalId || !subcategoryId) {
          console.warn(
            `Serviço "${service.title}" ignorado: profissional ${service.email} ` +
              `ou subcategoria "${service.subcategory}" não encontrado.`,
          );
          return [];
        }

        const key = serviceKey(professionalId, service.title);
        if (existingKeys.has(key)) return [];
        existingKeys.add(key);

        return [
          {
            title: service.title,
            description:
              `Serviço profissional de ${service.subcategory} ` +
              "com qualidade garantida",
            price: service.price,
            duration: service.duration,
            active: true,
            subcategory_id: subcategoryId,
            professional_id: professionalId,
            banner_uri: `https://picsum.photos/seed/${professionalId}/400/200`,
            created_at: now,
            updated_at: now,
          },
        ];
      });

      if (rows.length > 0) {
        await queryInterface.bulkInsert("service", rows, { transaction });
      }
      console.log(`Serviços iniciais criados: ${rows.length}.`);
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const emails = INITIAL_SERVICES.map((service) => service.email);
      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id, s.title, u.email
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails },
        transaction,
      );
      const seededPairs = new Set(
        INITIAL_SERVICES.map((service) => `${service.email}|${service.title}`),
      );
      const ids = services
        .filter((service) =>
          seededPairs.has(`${service.email}|${service.title}`),
        )
        .map((service) => Number(service.id));

      if (ids.length > 0) {
        await queryInterface.bulkDelete(
          "service",
          { id: { [Sequelize.Op.in]: ids } },
          { transaction },
        );
      }
    });
  },
};

"use strict";

require("dotenv").config();

const { QueryTypes, Sequelize } = require("sequelize");
const databaseConfigs = require("../config/config");

function createSequelize() {
  const environment =
    process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
  const selectedConfig = databaseConfigs[environment];

  if (!selectedConfig) {
    throw new Error(`Configuração de banco ausente para "${environment}".`);
  }

  const config = { ...selectedConfig };
  const environmentVariable = config.use_env_variable;
  delete config.use_env_variable;

  if (environmentVariable) {
    const connectionUrl = process.env[environmentVariable];
    if (!connectionUrl) {
      throw new Error(
        `A variável ${environmentVariable} não está configurada para o banco.`,
      );
    }
    return new Sequelize(connectionUrl, config);
  }

  return new Sequelize(
    config.database,
    config.username,
    config.password,
    config,
  );
}

async function auditCatalog() {
  const sequelize = createSequelize();

  try {
    const coverage = await sequelize.query(
      `SELECT
         c.id AS category_id,
         c.title AS category,
         sc.id AS subcategory_id,
         sc.title AS subcategory,
         COUNT(DISTINCT CASE WHEN s.active = true THEN s.id END) AS active_services,
         COUNT(
           DISTINCT CASE
             WHEN s.active = true AND sa.id IS NOT NULL THEN s.id
           END
         ) AS schedulable_services
       FROM category c
       INNER JOIN subcategory sc
         ON sc.category_id = c.id
        AND sc.active = true
       LEFT JOIN service s ON s.subcategory_id = sc.id
       LEFT JOIN service_availability sa ON sa.service_id = s.id
       WHERE c.active = true
       GROUP BY c.id, c.title, sc.id, sc.title
       ORDER BY c.title, sc.title`,
      { type: QueryTypes.SELECT },
    );

    const categoryCount = new Set(
      coverage.map((row) => Number(row.category_id)),
    ).size;
    const uncovered = coverage.filter(
      (row) => Number(row.active_services) === 0,
    );
    const withoutSchedule = coverage.filter(
      (row) => Number(row.schedulable_services) === 0,
    );
    const demoProviders = await sequelize.query(
      `SELECT
         p.id,
         u.email,
         p.description,
         p.service_radius_km,
         a.street,
         a.number,
         a.city,
         a.state,
         a.lat,
         a.lng,
         (SELECT COUNT(*)
            FROM professional_availability pa
           WHERE pa.professional_id = p.id
             AND pa.is_available = true) AS availability_rules,
         (SELECT COUNT(*)
            FROM service s
           WHERE s.professional_id = p.id
             AND s.active = true) AS active_services,
         (SELECT COUNT(*)
            FROM appointment ap
           WHERE ap.professional_id = p.id
             AND ap.status = 'completed'
             AND ap.rating IS NOT NULL) AS ratings
       FROM professional p
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN address a ON a.id = p.main_address_id
       WHERE u.email LIKE 'catalogo.%@demo.delbicos.local'
       ORDER BY u.email`,
      { type: QueryTypes.SELECT },
    );
    const incompleteProviders = demoProviders.filter(
      (provider) =>
        !provider.description ||
        Number(provider.service_radius_km) <= 0 ||
        !provider.street ||
        !provider.number ||
        !provider.city ||
        !provider.state ||
        provider.lat == null ||
        provider.lng == null ||
        Number(provider.availability_rules) === 0 ||
        Number(provider.active_services) === 0 ||
        Number(provider.ratings) === 0,
    );

    console.log(
      `Catálogo: ${categoryCount} categorias e ${coverage.length} subcategorias ativas.`,
    );
    console.log(
      `Prestadores demo: ${demoProviders.length} cadastrados com perfil, agenda e avaliações.`,
    );

    if (uncovered.length > 0) {
      console.error("Subcategorias sem serviço ativo:");
      console.table(
        uncovered.map(({ category, subcategory }) => ({
          categoria: category,
          subcategoria: subcategory,
        })),
      );
    }

    if (withoutSchedule.length > 0) {
      console.error("Subcategorias sem serviço ativo com horário:");
      console.table(
        withoutSchedule.map(({ category, subcategory }) => ({
          categoria: category,
          subcategoria: subcategory,
        })),
      );
    }

    if (demoProviders.length !== 12 || incompleteProviders.length > 0) {
      console.error(
        `Prestadores demo incompletos: esperados 12, encontrados ${demoProviders.length}.`,
      );
      if (incompleteProviders.length > 0) {
        console.table(
          incompleteProviders.map(({ email }) => ({ prestador: email })),
        );
      }
    }

    if (
      uncovered.length > 0 ||
      withoutSchedule.length > 0 ||
      demoProviders.length !== 12 ||
      incompleteProviders.length > 0
    ) {
      process.exitCode = 1;
      return;
    }

    console.log(
      "Cobertura completa: todas as subcategorias possuem serviço ativo com horário.",
    );
  } finally {
    await sequelize.close();
  }
}

auditCatalog().catch((error) => {
  console.error(`Falha ao auditar o catálogo: ${error.message}`);
  process.exitCode = 1;
});

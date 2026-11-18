"use strict";

/**
 * Imagens das categorias hospedadas no Azure Blob Storage (container publico
 * delbicos-uploads/categories). Substitui os links do bucket S3 da AWS, que
 * foi descontinuado, e a foto externa do Unsplash usada em Pet.
 * So troca imagens vazias ou desses provedores antigos: uma imagem enviada
 * manualmente pelo admin e preservada.
 */
const BASE_URL = (
  process.env.CATEGORY_IMAGE_BASE_URL ||
  "https://stdelbicos1786.blob.core.windows.net/delbicos-uploads/categories"
).replace(/\/+$/, "");

const CATEGORY_IMAGES = {
  "Saúde & Bem-Estar": "saude-e-bem-estar.jpg",
  "Beleza & Estética": "beleza-e-estetica.jpg",
  "Reformas & Reparos": "reformas-e-reparos.jpg",
  "Serviços Gerais": "servicos-gerais.jpg",
  "Serviços Domésticos": "servicos-domesticos.jpg",
  Pet: "pet.jpg",
};

module.exports = {
  async up(queryInterface) {
    for (const [title, file] of Object.entries(CATEGORY_IMAGES)) {
      await queryInterface.sequelize.query(
        `UPDATE category
            SET image_url = :url, updated_at = NOW()
          WHERE title = :title
            AND (image_url IS NULL
                 OR image_url LIKE '%amazonaws.com%'
                 OR image_url LIKE '%images.unsplash.com%')`,
        { replacements: { url: `${BASE_URL}/${file}`, title } },
      );
    }
  },

  async down(queryInterface) {
    // Volta ao estado anterior: sem imagem (o app mostra o icone da categoria).
    await queryInterface.sequelize.query(
      `UPDATE category SET image_url = NULL WHERE image_url LIKE :prefix`,
      { replacements: { prefix: `${BASE_URL}/%` } },
    );
  },
};

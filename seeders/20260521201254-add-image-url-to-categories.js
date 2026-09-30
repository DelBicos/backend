"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Imagens das categorias no Azure Blob Storage (container publico
    // delbicos-uploads/categories). O antigo bucket S3 da AWS foi descontinuado.
    const base = (
      process.env.CATEGORY_IMAGE_BASE_URL ||
      "https://stdelbicos1786.blob.core.windows.net/delbicos-uploads/categories"
    ).replace(/\/+$/, "");
    const categoryImages = [
      { title: "Saúde & Bem-Estar", image_url: `${base}/saude-e-bem-estar.jpg` },
      { title: "Beleza & Estética", image_url: `${base}/beleza-e-estetica.jpg` },
      { title: "Reformas & Reparos", image_url: `${base}/reformas-e-reparos.jpg` },
      { title: "Serviços Gerais", image_url: `${base}/servicos-gerais.jpg` },
      { title: "Serviços Domésticos", image_url: `${base}/servicos-domesticos.jpg` },
      { title: "Pet", image_url: `${base}/pet.jpg` },
    ];

    // Atualiza linha por linha baseado no título exato
    for (const category of categoryImages) {
      await queryInterface.bulkUpdate(
        "category",
        { 
          image_url: category.image_url,
          updated_at: new Date()
        },
        { title: category.title }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    // Caso precise dar undo nessa seed específica, ela limpa os campos de imagem
    await queryInterface.bulkUpdate(
      "category",
      { image_url: null },
      {
        title: [
          "Saúde & Bem-Estar",
          "Beleza & Estética",
          "Reformas & Reparos",
          "Serviços Gerais",
          "Serviços Domésticos",
          "Pet",
        ],
      }
    );
  },
};
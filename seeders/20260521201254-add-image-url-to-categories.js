"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Mapeamento dos links de imagem para cada título de categoria correspondente.
    // As categorias antigas usavam um bucket S3 (AWS), descontinuado; o app exibe
    // os ícones locais (src/assets/categories), então só a de Pet mantém URL.
    const categoryImages = [
      {
        title: "Pet",
        image_url: "https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=800&auto=format&fit=crop",
      },
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
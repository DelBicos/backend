module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('category', 'image_url', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    } catch (err) {
      console.log("Coluna image_url já existe em category, ignorando...");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('category', 'image_url');
  }
};
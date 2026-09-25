/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.sequelize.query(
      `SELECT id FROM users ORDER BY id`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!users.length) return;

    const welcomeNotifications = users.map((u) => ({
      user_id: u.id,
      title: "🎉 Bem-vindo(a) à Delbicos!",
      message:
        "Obrigado por se juntar a nós. Estamos felizes em tê-lo(a) a bordo. Explore todos os nossos recursos!",
      is_read: false,
      notification_type: "system",
      related_entity_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    await queryInterface.bulkInsert("notifications", welcomeNotifications, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete("notifications", {
        notification_type: "system",
        title: "🎉 Bem-vindo(a) à Delbicos!"
    }, {});
  },
};
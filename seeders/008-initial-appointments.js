"use strict";

const { customAlphabet } = require('nanoid');
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateShortId = customAlphabet(alphabet, 6);

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const clients = await queryInterface.sequelize.query(
      `SELECT * FROM client ORDER BY id`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const professionals = await queryInterface.sequelize.query(
      `SELECT * FROM professional ORDER BY id`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const services = await queryInterface.sequelize.query(
      `SELECT * FROM service ORDER BY professional_id`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!clients.length || !professionals.length || !services.length) {
      throw new Error(
        "Dados de cliente, profissional ou serviço insuficientes."
      );
    }

    const appointments = [];
    const statuses = ["pending", "confirmed", "completed", "canceled"];
    const reviews = [
      { rating: 5, text: "Excelente profissional! Recomendo." },
      { rating: 4, text: "Bom serviço, mas atrasou um pouco." },
      { rating: 5, text: "Perfeito! Muito rápido e eficiente." },
      { rating: 3, text: "Razoável, o acabamento poderia ser melhor." },
    ];

    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + ((1 + 7 - baseDate.getDay()) % 7));
    baseDate.setHours(9, 0, 0, 0);
    const now = new Date();

    clients.forEach((client, clientIndex) => {
      const nextProfessionalIndex = (clientIndex + 1) % professionals.length;
      const professional = professionals[nextProfessionalIndex];
      const service = services.find(
        (s) => s.professional_id === professional.id
      );

      if (!service) return;

      statuses.forEach((status, statusIndex) => {
        const appointmentDate = new Date(baseDate);
        appointmentDate.setDate(appointmentDate.getDate() + clientIndex);
        appointmentDate.setHours(9 + statusIndex * 2, 0, 0, 0);

        const startTime = new Date(appointmentDate);
        const endTime = new Date(appointmentDate);
        endTime.setMinutes(endTime.getMinutes() + service.duration);

        let rating = null;
        let review = null;
        let completed_at = null;
        let final_price = null;
        if (status === "completed") {
          // deterministic distribution across last 12 months for testing
          const monthsBack = 1 + ((clientIndex * statuses.length + statusIndex) % 12);
          completed_at = new Date(now);
          completed_at.setMonth(completed_at.getMonth() - monthsBack);
          // keep hour aligned with appointment start
          completed_at.setHours(appointmentDate.getHours(), appointmentDate.getMinutes(), 0, 0);

          const randomReview = reviews[clientIndex % reviews.length];
          rating = randomReview.rating;
          review = randomReview.text;

          // final_price deterministic: base price + statusIndex (so tests can assert)
          const basePrice = service && service.price ? parseFloat(service.price) : 0;
          final_price = parseFloat((basePrice + statusIndex).toFixed(2));
        }
        const usedShortIds = new Set();

        const shortId = generateShortId();
        while (usedShortIds.has(shortId)) {
          shortId = generateShortId();
        }
        usedShortIds.add(shortId);

        appointments.push({
          short_id: shortId,
          professional_id: professional.id,
          client_id: client.id,
          service_id: service.id,
          address_id: client.main_address_id,
          start_time: startTime,
          end_time: endTime,
          status: status,
          rating: rating,
          review: review,
          completed_at: completed_at,
          final_price: final_price,
          payment_intent_id:
            status === "completed" || status === "confirmed"
              ? `pi_seed_${client.id}_${professional.id}_${status}`
              : null,
          created_at: now,
          updated_at: now,
        });
      });
    });

    const shortId = generateShortId();


    await queryInterface.bulkInsert("appointment", appointments);
  },

  async down(queryInterface, Sequelize) {
    const clients = await queryInterface.sequelize.query(
      `SELECT c.id FROM client c 
       JOIN users u ON c.user_id = u.id 
       WHERE u.name IN ('Fernando Rasmut', 'Isabel Rodrigues', 'Douglas Ferreira', 'Gustavo Mendes', 'Eduardo Souza', 'Iago Silva', 'Lucas Lima')`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (clients.length > 0) {
      const clientIds = clients.map((client) => client.id);
      await queryInterface.bulkDelete(
        "appointment",
        {
          client_id: clientIds,
        },
        {}
      );
    }
  },
};

"use strict";
const bcrypt = require("bcryptjs");
const { customAlphabet } = require('nanoid');

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateShortId = customAlphabet(alphabet, 6);

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const salt = await bcrypt.genSalt(10);

    const demoData = [
      {
        name: "Carlos Silva Santos",
        email: "carlos.silva@delbicos.com",
        phone: "11987654321",
        cpf: "11122233344",
        cnpj: "11222333000144",
        desc: "Eletricista profissional com 15 anos de experiência.",
        avatar: "https://i.pravatar.cc/150?img=12",
        banner: "https://picsum.photos/seed/carlos/800/200",
        street: "Rua da Elétrica",
        number: "100",
        city: "São Paulo",
        state: "SP",
        zip: "01001000",
        lat: -23.5505,
        lng: -46.6333,
      },
      {
        name: "Maria Fernanda Costa",
        email: "maria.costa@delbicos.com",
        phone: "11976543210",
        cpf: "22233344455",
        cnpj: null,
        desc: "Diarista experiente e cuidadosa. Limpeza residencial detalhada.",
        avatar: "https://i.pravatar.cc/150?img=47",
        banner: "https://picsum.photos/seed/maria/800/200",
        street: "Av. Paulista",
        number: "500",
        city: "São Paulo",
        state: "SP",
        zip: "01310000",
        lat: -23.5615,
        lng: -46.656,
      },
      {
        name: "João Pedro Oliveira",
        email: "joao.oliveira@delbicos.com",
        phone: "11965432109",
        cpf: "33344455566",
        cnpj: "22333444000155",
        desc: "Encanador profissional certificado. Caça vazamentos e reparos.",
        avatar: "https://i.pravatar.cc/150?img=33",
        banner: "https://picsum.photos/seed/joao/800/200",
        street: "Rua Augusta",
        number: "1200",
        city: "São Paulo",
        state: "SP",
        zip: "01305100",
        lat: -23.55,
        lng: -46.66,
      },
      {
        name: "Ana Paula Rodrigues",
        email: "ana.rodrigues@delbicos.com",
        phone: "11954321098",
        cpf: "44455566677",
        cnpj: null,
        desc: "Designer de interiores. Transformo ambientes com criatividade.",
        avatar: "https://i.pravatar.cc/150?img=48",
        banner: "https://picsum.photos/seed/ana/800/200",
        street: "Rua Oscar Freire",
        number: "800",
        city: "São Paulo",
        state: "SP",
        zip: "01426000",
        lat: -23.56,
        lng: -46.67,
      },
      {
        name: "Ricardo Almeida Souza",
        email: "ricardo.souza@delbicos.com",
        phone: "11943210987",
        cpf: "55566677788",
        cnpj: "33444555000166",
        desc: "Pedreiro e mestre de obras. Reformas do básico ao acabamento.",
        avatar: "https://i.pravatar.cc/150?img=14",
        banner: "https://picsum.photos/seed/ricardo/800/200",
        street: "Av. Faria Lima",
        number: "2000",
        city: "São Paulo",
        state: "SP",
        zip: "01452000",
        lat: -23.57,
        lng: -46.69,
      },
      {
        name: "Patricia Lima Santos",
        email: "patricia.lima@delbicos.com",
        phone: "11932109876",
        cpf: "66677788899",
        cnpj: null,
        desc: "Manicure e pedicure a domicílio. Material esterilizado.",
        avatar: "https://i.pravatar.cc/150?img=49",
        banner: "https://picsum.photos/seed/patricia/800/200",
        street: "Rua da Consolação",
        number: "100",
        city: "São Paulo",
        state: "SP",
        zip: "01302000",
        lat: -23.54,
        lng: -46.65,
      },
      {
        name: "Fernando Henrique Dias",
        email: "fernando.dias@delbicos.com",
        phone: "11921098765",
        cpf: "77788899900",
        cnpj: "44555666000177",
        desc: "Jardineiro e paisagista. Cuido do seu jardim com carinho.",
        avatar: "https://i.pravatar.cc/150?img=15",
        banner: "https://picsum.photos/seed/fernando/800/200",
        street: "Av. Ibirapuera",
        number: "1500",
        city: "São Paulo",
        state: "SP",
        zip: "04028000",
        lat: -23.59,
        lng: -46.66,
      },
      {
        name: "Juliana Martins Pereira",
        email: "juliana.martins@delbicos.com",
        phone: "11910987654",
        cpf: "88899900011",
        cnpj: null,
        desc: "Personal Organizer. Organização de armários, mudanças e home office.",
        avatar: "https://i.pravatar.cc/150?img=44",
        banner: "https://picsum.photos/seed/juliana/800/200",
        street: "Rua Pamplona",
        number: "500",
        city: "São Paulo",
        state: "SP",
        zip: "01405000",
        lat: -23.565,
        lng: -46.655,
      },
    ];

    const passwordHash = await bcrypt.hash("senha123", salt);

    const usersToInsert = demoData.map((d) => ({
      name: d.name,
      email: d.email,
      phone: d.phone,
      password: passwordHash,
      active: true,
      avatar_uri: d.avatar,
      banner_uri: d.banner,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert("users", usersToInsert);

    const users = await queryInterface.sequelize.query(
      `SELECT id, email FROM users WHERE email IN (${demoData
        .map((d) => `'${d.email}'`)
        .join(",")})`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const userMap = users.reduce((acc, u) => ({ ...acc, [u.email]: u.id }), {});

    const addressesToInsert = demoData.map((d) => ({
      user_id: userMap[d.email],
      street: d.street,
      number: d.number,
      neighborhood: "Centro",
      city: d.city,
      state: d.state,
      country_iso: "BR",
      postal_code: d.zip,
      lat: d.lat,
      lng: d.lng,
      active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert("address", addressesToInsert);

    const addresses = await queryInterface.sequelize.query(
      `SELECT id, user_id FROM address WHERE user_id IN (${Object.values(
        userMap
      ).join(",")})`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const addressMap = addresses.reduce(
      (acc, a) => ({ ...acc, [a.user_id]: a.id }),
      {}
    );

    const professionalsToInsert = demoData.map((d) => {
      const userId = userMap[d.email];
      return {
        user_id: userId,
        main_address_id: addressMap[userId],
        cpf: d.cpf,
        cnpj: d.cnpj,
        description: d.desc,
        created_at: now,
        updated_at: now,
      };
    });

    await queryInterface.bulkInsert("professional", professionalsToInsert);

    const professionalsData = await queryInterface.sequelize.query(
      `SELECT id, user_id FROM professional WHERE user_id IN (${Object.values(
        userMap
      ).join(",")})`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    const clients = await queryInterface.sequelize.query(
      "SELECT id FROM client LIMIT 5",
      { type: Sequelize.QueryTypes.SELECT }
    );
    const services = await queryInterface.sequelize.query(
      "SELECT id FROM service LIMIT 10",
      { type: Sequelize.QueryTypes.SELECT }
    );
    const addrList = await queryInterface.sequelize.query(
      "SELECT id FROM address LIMIT 8",
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (clients.length && services.length && addrList.length) {
      const appointments = [];
      const reviews = [
        { rating: 5, text: "Excelente! Super recomendo." },
        { rating: 4, text: "Muito bom, apenas um pequeno atraso." },
        { rating: 5, text: "Perfeito! Nota 10." },
        { rating: 5, text: "Ótimo profissional." },
      ];

      const usedShortIds = new Set();


      professionalsData.forEach((prof, index) => {
        const numAppointments = 3 + (index % 3);
        for (let i = 0; i < numAppointments; i++) {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - (10 + i * 5));
          const endDate = new Date(startDate);
          endDate.setHours(endDate.getHours() + 2);

          const review = reviews[i % reviews.length];

          let shortId;
          do {
            shortId = generateShortId();
          } while (usedShortIds.has(shortId));
          usedShortIds.add(shortId);

          appointments.push({
            short_id: shortId,
            professional_id: prof.id,
            client_id: clients[i % clients.length].id,
            service_id: services[i % services.length].id,
            address_id: addrList[i % addrList.length].id,
            start_time: startDate,
            end_time: endDate,
            status: "completed",
            rating: review.rating,
            review: review.text,
            payment_intent_id: `pi_demo_${prof.id}_${i}_${now.getTime()}`,
            created_at: startDate,
            updated_at: endDate,
          });
        }
      });

      await queryInterface.bulkInsert("appointment", appointments);
    }
  },

  async down(queryInterface, Sequelize) {
    const emails = [
      "carlos.silva@delbicos.com",
      "maria.costa@delbicos.com",
      "joao.oliveira@delbicos.com",
      "ana.rodrigues@delbicos.com",
      "ricardo.souza@delbicos.com",
      "patricia.lima@delbicos.com",
      "fernando.dias@delbicos.com",
      "juliana.martins@delbicos.com",
    ];

    await queryInterface.bulkDelete("users", {
      email: { [Sequelize.Op.in]: emails },
    });
  },
};

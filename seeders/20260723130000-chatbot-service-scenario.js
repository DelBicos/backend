"use strict";

const SERVICE_TITLE = "Instalação de Tomada Inteligente";
const SUBCATEGORY_TITLE = "Eletricista";
const SERVICE_BANNER_PREFIX =
  "https://picsum.photos/seed/chatbot-service-";
const FERNANDO_EMAIL = "fernando@delbicos.com.br";
const SEEDED_AUTH_SESSION_ID = "seed:chatbot-fernando";
const SEEDED_SESSION_CHANNEL = "seed-chatbot-test";

const PROFESSIONAL_SCENARIOS = [
  {
    email: "iago@delbicos.com.br",
    slug: "iago",
    description:
      "Instalação e configuração de tomada inteligente Wi-Fi, incluindo testes de segurança e orientação de uso.",
    priceCents: 15000,
    duration: 90,
    availability: {
      days: [1, 2, 3, 4, 5, 6],
      start: "08:00:00",
      end: "19:00:00",
    },
    reviews: [
      {
        rating: 5,
        review:
          "Instalação impecável e aplicativo configurado corretamente.",
        daysAgo: 60,
      },
      {
        rating: 5,
        review: "Serviço rápido, organizado e muito bem explicado.",
        daysAgo: 30,
      },
    ],
  },
  {
    email: "isabel@delbicos.com.br",
    slug: "isabel",
    description:
      "Instalação de tomada inteligente com integração a assistentes virtuais e revisão do ponto elétrico.",
    priceCents: 13500,
    duration: 75,
    availability: {
      days: [1, 2, 3, 4, 5],
      start: "09:00:00",
      end: "17:00:00",
    },
    reviews: [
      {
        rating: 4,
        review: "Bom atendimento e instalação feita com cuidado.",
        daysAgo: 50,
      },
      {
        rating: 5,
        review: "Funcionou perfeitamente com a automação da residência.",
        daysAgo: 20,
      },
    ],
  },
  {
    email: "douglas@delbicos.com.br",
    slug: "douglas",
    description:
      "Instalação de tomada inteligente, pareamento no celular e demonstração das rotinas de automação.",
    priceCents: 12000,
    duration: 60,
    availability: {
      days: [1, 3, 5, 6],
      start: "08:00:00",
      end: "16:00:00",
    },
    reviews: [],
  },
];

const SEEDED_REVIEW_PAYMENT_IDS = PROFESSIONAL_SCENARIOS.flatMap(
  (scenario) =>
    scenario.reviews.map(
      (_review, index) =>
        `seed_chatbot_review_${scenario.slug}_${index + 1}`,
    ),
);

function requireExactlyOne(rows, description) {
  if (rows.length !== 1) {
    throw new Error(
      `${description}: esperado exatamente 1 registro, encontrados ${rows.length}.`,
    );
  }
  return rows[0];
}

function getSaoPauloCalendarDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function createSaoPauloDateTime(year, month, day, hour, minute = 0) {
  return new Date(
    Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0),
  );
}

function createPastDate(daysAgo, hour) {
  const today = getSaoPauloCalendarDate();
  const target = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12),
  );
  target.setUTCDate(target.getUTCDate() - daysAgo);
  return createSaoPauloDateTime(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    hour,
  );
}

function createNextMonday(hour) {
  const today = getSaoPauloCalendarDate();
  const target = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12),
  );
  let daysUntilMonday = (8 - target.getUTCDay()) % 7;
  if (daysUntilMonday < 2) daysUntilMonday += 7;
  target.setUTCDate(target.getUTCDate() + daysUntilMonday);
  return createSaoPauloDateTime(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    hour,
  );
}

function formatLocalDate(date) {
  const { year, month: monthValue, day: dayValue } =
    getSaoPauloCalendarDate(date);
  const month = String(monthValue).padStart(2, "0");
  const day = String(dayValue).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.hour}:${values.minute}`;
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

function parseJsonValue(value) {
  if (value == null || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function loadOriginalAppointmentId(
  queryInterface,
  Sequelize,
  sessionId,
  transaction,
) {
  const eventMessages = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT entities
     FROM bot_chat_message
     WHERE session_id = :sessionId
       AND entities IS NOT NULL
     ORDER BY id`,
    { sessionId },
    transaction,
  );
  const creationEvents = eventMessages
    .map((message) => parseJsonValue(message.entities))
    .filter(
      (entities) =>
        entities?.event === "appointment_created" &&
        entities.appointment_id != null,
    );

  if (creationEvents.length !== 1) {
    throw new Error(
      "Não foi possível identificar com segurança o agendamento " +
        "original da sessão de teste.",
    );
  }

  return Number(creationEvents[0].appointment_id);
}

async function loadProfessional(
  queryInterface,
  Sequelize,
  email,
  transaction,
) {
  const rows = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT
       u.id AS user_id,
       u.name AS professional_name,
       u.avatar_uri,
       p.id AS professional_id,
       p.description AS professional_description,
       a.city,
       a.state
     FROM users u
     INNER JOIN professional p ON p.user_id = u.id
     LEFT JOIN address a ON a.id = p.main_address_id
     WHERE u.email = :email`,
    { email },
    transaction,
  );

  return requireExactlyOne(rows, `Profissional ${email}`);
}

async function loadFernando(
  queryInterface,
  Sequelize,
  transaction,
) {
  const rows = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT
       u.id AS user_id,
       u.name AS client_name,
       c.id AS client_id,
       c.main_address_id AS address_id
     FROM users u
     INNER JOIN client c ON c.user_id = u.id
     WHERE u.email = :email`,
    { email: FERNANDO_EMAIL },
    transaction,
  );
  const fernando = requireExactlyOne(rows, `Cliente ${FERNANDO_EMAIL}`);

  if (!fernando.address_id) {
    throw new Error(
      `Cliente ${FERNANDO_EMAIL} precisa ter um endereço principal.`,
    );
  }

  return fernando;
}

async function ensureService(
  queryInterface,
  Sequelize,
  professional,
  scenario,
  subcategory,
  now,
  transaction,
) {
  const existing = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id, banner_uri
     FROM service
     WHERE professional_id = :professionalId
       AND subcategory_id = :subcategoryId
       AND title = :title`,
    {
      professionalId: professional.professional_id,
      subcategoryId: subcategory.subcategory_id,
      title: SERVICE_TITLE,
    },
    transaction,
  );

  if (existing.length > 1) {
    throw new Error(
      `Há mais de um serviço "${SERVICE_TITLE}" para ${scenario.email}.`,
    );
  }

  const values = {
    title: SERVICE_TITLE,
    description: scenario.description,
    price: (scenario.priceCents / 100).toFixed(2),
    price_cents: scenario.priceCents,
    duration: scenario.duration,
    active: true,
    category_id: subcategory.category_id,
    subcategory_id: subcategory.subcategory_id,
    professional_id: professional.professional_id,
    banner_uri: `${SERVICE_BANNER_PREFIX}${scenario.slug}/400/200`,
    updated_at: now,
  };

  if (existing.length === 0) {
    await queryInterface.bulkInsert(
      "service",
      [{ ...values, created_at: now }],
      { transaction },
    );
  } else {
    const service = existing[0];
    if (
      !service.banner_uri ||
      !service.banner_uri.startsWith(SERVICE_BANNER_PREFIX)
    ) {
      throw new Error(
        `O serviço "${SERVICE_TITLE}" de ${scenario.email} já existe e não pertence ao cenário do chatbot.`,
      );
    }

    await queryInterface.bulkUpdate(
      "service",
      values,
      { id: service.id },
      { transaction },
    );
  }

  const rows = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id
     FROM service
     WHERE professional_id = :professionalId
       AND subcategory_id = :subcategoryId
       AND title = :title`,
    {
      professionalId: professional.professional_id,
      subcategoryId: subcategory.subcategory_id,
      title: SERVICE_TITLE,
    },
    transaction,
  );

  const service = requireExactlyOne(
    rows,
    `Serviço "${SERVICE_TITLE}" de ${scenario.email}`,
  );

  return {
    ...scenario,
    ...professional,
    serviceId: service.id,
  };
}

async function ensureReviewAppointments(
  queryInterface,
  Sequelize,
  fernando,
  services,
  now,
  transaction,
) {
  for (const service of services) {
    for (const [index, review] of service.reviews.entries()) {
      const paymentIntentId = `seed_chatbot_review_${service.slug}_${index + 1}`;
      const existing = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT
           id,
           professional_id,
           client_id,
           service_id,
           status,
           rating
         FROM appointment
         WHERE payment_intent_id = :paymentIntentId`,
        { paymentIntentId },
        transaction,
      );

      if (existing.length > 0) {
        const appointment = requireExactlyOne(
          existing,
          `Avaliação ${paymentIntentId}`,
        );
        const isExpectedAppointment =
          Number(appointment.professional_id) ===
            Number(service.professional_id) &&
          Number(appointment.client_id) === Number(fernando.client_id) &&
          Number(appointment.service_id) === Number(service.serviceId) &&
          appointment.status === "completed" &&
          Number(appointment.rating) === review.rating;

        if (!isExpectedAppointment) {
          throw new Error(
            `O identificador ${paymentIntentId} já pertence a outro agendamento.`,
          );
        }
        continue;
      }

      const startTime = createPastDate(review.daysAgo, 10 + index);
      const endTime = new Date(
        startTime.getTime() + service.duration * 60 * 1000,
      );

      await queryInterface.bulkInsert(
        "appointment",
        [
          {
            professional_id: service.professional_id,
            client_id: fernando.client_id,
            service_id: service.serviceId,
            address_id: fernando.address_id,
            start_time: startTime,
            end_time: endTime,
            status: "completed",
            rating: review.rating,
            review: review.review,
            completed_at: endTime,
            final_price: (service.priceCents / 100).toFixed(2),
            payment_intent_id: paymentIntentId,
            created_at: startTime,
            updated_at: now,
          },
        ],
        { transaction },
      );
    }
  }
}

async function ensurePendingAppointment(
  queryInterface,
  Sequelize,
  fernando,
  iagoService,
  now,
  transaction,
) {
  const seededSessions = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT
       bcs.id AS session_id,
       a.id,
       a.client_id,
       a.professional_id,
       a.service_id,
       a.start_time,
       a.end_time,
       a.status
     FROM bot_chat_session bcs
     INNER JOIN appointment a ON a.id = bcs.appointment_id
     WHERE bcs.user_id = :userId
       AND bcs.channel = :channel
     ORDER BY bcs.id DESC`,
    {
      userId: fernando.user_id,
      channel: SEEDED_SESSION_CHANNEL,
    },
    transaction,
  );

  if (seededSessions.length > 1) {
    throw new Error(
      "Há mais de uma sessão do cenário de teste para Fernando.",
    );
  }

  if (seededSessions.length === 1) {
    const appointment = seededSessions[0];
    const originalAppointmentId = await loadOriginalAppointmentId(
      queryInterface,
      Sequelize,
      appointment.session_id,
      transaction,
    );
    if (Number(appointment.id) !== originalAppointmentId) {
      throw new Error(
        "A sessão de teste já foi reutilizada em outro agendamento. " +
          "Desfaça o seed antes de recriar o cenário.",
      );
    }
    const belongsToScenario =
      Number(appointment.client_id) === Number(fernando.client_id) &&
      Number(appointment.professional_id) ===
        Number(iagoService.professional_id) &&
      Number(appointment.service_id) === Number(iagoService.serviceId);
    if (!belongsToScenario) {
      throw new Error(
        "A sessão marcada como cenário do chatbot aponta para outro agendamento.",
      );
    }
    if (appointment.status !== "pending") {
      throw new Error(
        `O agendamento do cenário já está ${appointment.status}. ` +
          "Desfaça o seed antes de recriar o cenário pendente.",
      );
    }
    return appointment;
  }

  const startTime = createNextMonday(10);
  const endTime = new Date(
    startTime.getTime() + iagoService.duration * 60 * 1000,
  );

  await queryInterface.bulkInsert(
    "appointment",
    [
      {
        professional_id: iagoService.professional_id,
        client_id: fernando.client_id,
        service_id: iagoService.serviceId,
        address_id: fernando.address_id,
        start_time: startTime,
        end_time: endTime,
        status: "pending",
        rating: null,
        review: null,
        completed_at: null,
        final_price: null,
        payment_intent_id: null,
        created_at: now,
        updated_at: now,
      },
    ],
    { transaction },
  );

  const rows = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id, start_time, end_time, status
     FROM appointment
     WHERE client_id = :clientId
       AND professional_id = :professionalId
       AND service_id = :serviceId
       AND payment_intent_id IS NULL
       AND review IS NULL
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1`,
    {
      clientId: fernando.client_id,
      professionalId: iagoService.professional_id,
      serviceId: iagoService.serviceId,
    },
    transaction,
  );

  return requireExactlyOne(rows, "Agendamento pendente Fernando → Iago");
}

async function ensureChatRoom(
  queryInterface,
  Sequelize,
  fernando,
  iagoService,
  appointment,
  now,
  transaction,
) {
  const existing = await selectRows(
    queryInterface,
    Sequelize,
    "SELECT id FROM chat_room WHERE appointment_id = :appointmentId",
    { appointmentId: appointment.id },
    transaction,
  );

  if (existing.length > 0) return;

  await queryInterface.bulkInsert(
    "chat_room",
    [
      {
        appointment_id: appointment.id,
        professional_id: iagoService.professional_id,
        client_id: fernando.client_id,
        service_id: iagoService.serviceId,
        status: "active",
        last_message_preview:
          "Agendamento enviado pelo chatbot e aguardando o profissional.",
        last_message_at: now,
        last_sender_user_id: fernando.user_id,
        created_at: now,
        updated_at: now,
      },
    ],
    { transaction },
  );
}

async function ensureNotifications(
  queryInterface,
  Sequelize,
  fernando,
  iagoService,
  appointment,
  now,
  transaction,
) {
  const appointmentDate = formatLocalDate(new Date(appointment.start_time));
  const appointmentTime = formatLocalTime(
    new Date(appointment.start_time),
  );
  const notifications = [
    {
      user_id: iagoService.user_id,
      title: "Novo Agendamento Recebido",
      message:
        `${fernando.client_name} solicitou "${SERVICE_TITLE}" para ` +
        `${appointmentDate} às ${appointmentTime}.`,
    },
    {
      user_id: fernando.user_id,
      title: "Agendamento Criado",
      message:
        `Seu agendamento de "${SERVICE_TITLE}" com ` +
        `${iagoService.professional_name} aguarda confirmação.`,
    },
  ];

  for (const notification of notifications) {
    const existing = await selectRows(
      queryInterface,
      Sequelize,
      `SELECT id
       FROM notifications
       WHERE user_id = :userId
         AND title = :title
         AND related_entity_id = :appointmentId
         AND notification_type = 'appointment'`,
      {
        userId: notification.user_id,
        title: notification.title,
        appointmentId: appointment.id,
      },
      transaction,
    );
    if (existing.length > 0) continue;

    await queryInterface.bulkInsert(
      "notifications",
      [
        {
          ...notification,
          is_read: false,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          created_at: now,
          updated_at: now,
        },
      ],
      { transaction },
    );
  }
}

async function ensureBotSession(
  queryInterface,
  Sequelize,
  fernando,
  iagoService,
  appointment,
  now,
  transaction,
) {
  const appointmentStart = new Date(appointment.start_time);
  const appointmentTime = formatLocalTime(appointmentStart);
  const isWaiting = appointment.status === "pending";
  const sessionState = isWaiting ? "AGUARDANDO_CONFIRMACAO" : "INICIO";
  const context = {
    intent: "AGENDAR",
    pendingAction: "CREATE",
    serviceId: iagoService.serviceId,
    serviceName: SERVICE_TITLE,
    serviceDescription: iagoService.description,
    serviceSubcategoryId: iagoService.subcategoryId,
    serviceSubcategoryName: SUBCATEGORY_TITLE,
    serviceCategoryName: iagoService.categoryName,
    servicePrice: iagoService.priceCents,
    serviceDuration: iagoService.duration,
    professionalId: iagoService.professional_id,
    professionalName: iagoService.professional_name,
    professionalAvatarUri: iagoService.avatar_uri,
    professionalRating: 5,
    professionalRatingsCount: iagoService.reviews.length,
    professionalCity: iagoService.city,
    professionalState: iagoService.state,
    date: formatLocalDate(appointmentStart),
    time: appointmentTime,
    appointmentId: appointment.id,
    appointmentStatus: appointment.status,
    matchedServiceIds: [iagoService.serviceId],
  };

  const competingSessions = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id, channel, appointment_id
     FROM bot_chat_session
     WHERE user_id = :userId
       AND status = 'active'`,
    {
      userId: fernando.user_id,
    },
    transaction,
  );
  const foreignActiveSessions = competingSessions.filter(
    (session) =>
      session.channel !== SEEDED_SESSION_CHANNEL ||
      Number(session.appointment_id) !== Number(appointment.id),
  );
  if (foreignActiveSessions.length > 0) {
    throw new Error(
      `Fernando possui ${foreignActiveSessions.length} outra(s) sessão(ões) ativa(s). ` +
        "Finalize-as antes de aplicar o cenário de teste do chatbot.",
    );
  }

  const existing = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id
     FROM bot_chat_session
     WHERE user_id = :userId
       AND appointment_id = :appointmentId
       AND channel = :channel`,
    {
      userId: fernando.user_id,
      appointmentId: appointment.id,
      channel: SEEDED_SESSION_CHANNEL,
    },
    transaction,
  );

  if (existing.length > 1) {
    throw new Error("Há mais de uma sessão ativa para o cenário do chatbot.");
  }

  if (existing.length === 0) {
    await queryInterface.bulkInsert(
      "bot_chat_session",
      [
        {
          user_id: fernando.user_id,
          auth_session_id: SEEDED_AUTH_SESSION_ID,
          channel: SEEDED_SESSION_CHANNEL,
          status: "active",
          state: sessionState,
          context: JSON.stringify(context),
          appointment_id: appointment.id,
          started_at: now,
          ended_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      { transaction },
    );
  } else {
    await queryInterface.bulkUpdate(
      "bot_chat_session",
      {
        status: "active",
        state: sessionState,
        context: JSON.stringify(context),
        appointment_id: appointment.id,
        ended_at: null,
        updated_at: now,
      },
      { id: existing[0].id },
      { transaction },
    );
  }

  const sessions = await selectRows(
    queryInterface,
    Sequelize,
    `SELECT id
     FROM bot_chat_session
     WHERE user_id = :userId
       AND appointment_id = :appointmentId
       AND channel = :channel`,
    {
      userId: fernando.user_id,
      appointmentId: appointment.id,
      channel: SEEDED_SESSION_CHANNEL,
    },
    transaction,
  );
  const session = requireExactlyOne(
    sessions,
    "Sessão do chatbot para Fernando",
  );

  const messages = await selectRows(
    queryInterface,
    Sequelize,
    "SELECT id FROM bot_chat_message WHERE session_id = :sessionId LIMIT 1",
    { sessionId: session.id },
    transaction,
  );

  if (messages.length > 0) return;

  const appointmentDate = formatLocalDate(appointmentStart);
  const history = [
    {
      sender: "user",
      content: `Quero agendar ${SERVICE_TITLE.toLowerCase()}.`,
      intent: "AGENDAR",
      entities: JSON.stringify({
        service: SERVICE_TITLE.toLowerCase(),
      }),
    },
    {
      sender: "bot",
      content:
        `Encontrei ${PROFESSIONAL_SCENARIOS.length} profissionais para ` +
        `"${SERVICE_TITLE}", na subcategoria "${SUBCATEGORY_TITLE}".`,
      intent: null,
      entities: null,
    },
    {
      sender: "user",
      content: iagoService.professional_name,
      intent: null,
      entities: null,
    },
    {
      sender: "bot",
      content:
        `Você escolheu "${SERVICE_TITLE}" com ` +
        `${iagoService.professional_name}. Avaliação neste serviço: 5.0 de 5.`,
      intent: null,
      entities: null,
    },
    {
      sender: "user",
      content: `${appointmentDate} às ${appointmentTime}`,
      intent: null,
      entities: null,
    },
    {
      sender: "bot",
      content:
        `Agendamento ID ${appointment.id} enviado para ` +
        `${iagoService.professional_name}. ` +
        (isWaiting
          ? "O profissional tem até 12 horas para responder. "
          : `Situação atual: ${appointment.status}. `) +
        "Você pode fechar ou atualizar a página; a conversa continuará " +
        "disponível no histórico.",
      intent: null,
      entities: JSON.stringify({
        event: "appointment_created",
        appointment_id: appointment.id,
        status: "pending",
      }),
    },
  ];

  await queryInterface.bulkInsert(
    "bot_chat_message",
    history.map((message, index) => {
      const createdAt = new Date(
        now.getTime() - (history.length - index) * 60 * 1000,
      );
      return {
        session_id: session.id,
        ...message,
        created_at: createdAt,
        updated_at: createdAt,
      };
    }),
    { transaction },
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const fernando = await loadFernando(
        queryInterface,
        Sequelize,
        transaction,
      );
      const subcategories = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id AS subcategory_id, category_id
         FROM subcategory
         WHERE title = :title`,
        { title: SUBCATEGORY_TITLE },
        transaction,
      );
      const subcategory = requireExactlyOne(
        subcategories,
        `Subcategoria ${SUBCATEGORY_TITLE}`,
      );

      const categories = await selectRows(
        queryInterface,
        Sequelize,
        "SELECT title FROM category WHERE id = :categoryId",
        { categoryId: subcategory.category_id },
        transaction,
      );
      const category = requireExactlyOne(
        categories,
        `Categoria da subcategoria ${SUBCATEGORY_TITLE}`,
      );

      const services = [];
      for (const scenario of PROFESSIONAL_SCENARIOS) {
        const professional = await loadProfessional(
          queryInterface,
          Sequelize,
          scenario.email,
          transaction,
        );
        const service = await ensureService(
          queryInterface,
          Sequelize,
          professional,
          scenario,
          subcategory,
          now,
          transaction,
        );
        services.push({
          ...service,
          subcategoryId: subcategory.subcategory_id,
          categoryName: category.title,
        });
      }

      const serviceIds = services.map((service) => service.serviceId);
      await queryInterface.bulkDelete(
        "service_availability",
        {
          service_id: {
            [Sequelize.Op.in]: serviceIds,
          },
        },
        { transaction },
      );

      const availabilityRows = services.flatMap((service) =>
        service.availability.days.map((day) => ({
          service_id: service.serviceId,
          day_of_week: day,
          start_time: service.availability.start,
          end_time: service.availability.end,
          created_at: now,
          updated_at: now,
        })),
      );
      await queryInterface.bulkInsert(
        "service_availability",
        availabilityRows,
        { transaction },
      );

      await ensureReviewAppointments(
        queryInterface,
        Sequelize,
        fernando,
        services,
        now,
        transaction,
      );

      const iagoService = services.find(
        (service) => service.email === "iago@delbicos.com.br",
      );
      if (!iagoService) {
        throw new Error("Serviço de teste do profissional Iago não encontrado.");
      }

      const appointment = await ensurePendingAppointment(
        queryInterface,
        Sequelize,
        fernando,
        iagoService,
        now,
        transaction,
      );
      await ensureChatRoom(
        queryInterface,
        Sequelize,
        fernando,
        iagoService,
        appointment,
        now,
        transaction,
      );
      await ensureNotifications(
        queryInterface,
        Sequelize,
        fernando,
        iagoService,
        appointment,
        now,
        transaction,
      );
      await ensureBotSession(
        queryInterface,
        Sequelize,
        fernando,
        iagoService,
        appointment,
        now,
        transaction,
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const services = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id
         FROM service s
         INNER JOIN professional p ON p.id = s.professional_id
         INNER JOIN users u ON u.id = p.user_id
         INNER JOIN subcategory sc ON sc.id = s.subcategory_id
         WHERE s.title = :title
           AND sc.title = :subcategoryTitle
           AND s.banner_uri LIKE :bannerPrefix
           AND u.email IN (:emails)`,
        {
          title: SERVICE_TITLE,
          subcategoryTitle: SUBCATEGORY_TITLE,
          bannerPrefix: `${SERVICE_BANNER_PREFIX}%`,
          emails: PROFESSIONAL_SCENARIOS.map((scenario) => scenario.email),
        },
        transaction,
      );
      const serviceIds = services.map((service) => service.id);

      if (serviceIds.length === 0) return;

      const seededSessions = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT bcs.id, bcs.appointment_id
         FROM bot_chat_session bcs
         INNER JOIN users u ON u.id = bcs.user_id
         WHERE bcs.channel = :channel
           AND u.email = :email`,
        {
          channel: SEEDED_SESSION_CHANNEL,
          email: FERNANDO_EMAIL,
        },
        transaction,
      );
      if (seededSessions.length > 1) {
        throw new Error(
          "Há mais de uma sessão marcada como cenário de teste do chatbot.",
        );
      }

      let scenarioAppointmentId = null;
      if (seededSessions.length === 1) {
        const session = seededSessions[0];
        scenarioAppointmentId = await loadOriginalAppointmentId(
          queryInterface,
          Sequelize,
          session.id,
          transaction,
        );
        if (
          session.appointment_id != null &&
          Number(session.appointment_id) !== scenarioAppointmentId
        ) {
          throw new Error(
            "A sessão de teste já foi reutilizada em outro agendamento. " +
              "Revise a sessão antes de desfazer o seed.",
          );
        }
      }

      const reviewAppointments = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id
         FROM appointment
         WHERE service_id IN (:serviceIds)
           AND payment_intent_id IN (:paymentIntentIds)`,
        {
          serviceIds,
          paymentIntentIds: SEEDED_REVIEW_PAYMENT_IDS,
        },
        transaction,
      );
      const appointmentIds = reviewAppointments.map(
        (appointment) => appointment.id,
      );

      if (scenarioAppointmentId != null) {
        const scenarioAppointments = await selectRows(
          queryInterface,
          Sequelize,
          `SELECT id, service_id
           FROM appointment
           WHERE id = :appointmentId`,
          { appointmentId: scenarioAppointmentId },
          transaction,
        );
        if (scenarioAppointments.length === 1) {
          const belongsToScenario = serviceIds.some(
            (serviceId) =>
              Number(serviceId) ===
              Number(scenarioAppointments[0].service_id),
          );
          if (!belongsToScenario) {
            throw new Error(
              "O agendamento original da sessão não pertence aos serviços do seed.",
            );
          }
          appointmentIds.push(scenarioAppointmentId);
        }
      }

      if (seededSessions.length === 1) {
        await queryInterface.bulkDelete(
          "bot_chat_session",
          { id: seededSessions[0].id },
          { transaction },
        );
      }

      if (appointmentIds.length > 0) {
        const appointmentFilter = {
          [Sequelize.Op.in]: [...new Set(appointmentIds)],
        };
        await queryInterface.bulkDelete(
          "notifications",
          {
            related_entity_id: appointmentFilter,
            notification_type: "appointment",
          },
          { transaction },
        );
        await queryInterface.bulkDelete(
          "chat_room",
          { appointment_id: appointmentFilter },
          { transaction },
        );
        await queryInterface.bulkDelete(
          "appointment",
          { id: appointmentFilter },
          { transaction },
        );
      }

      const remainingAppointments = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id
         FROM appointment
         WHERE service_id IN (:serviceIds)
         LIMIT 1`,
        { serviceIds },
        transaction,
      );
      if (remainingAppointments.length > 0) {
        throw new Error(
          "Há agendamentos não pertencentes ao seed usando os serviços do " +
            "cenário. Cancele ou remova esses registros antes de desfazer o seed.",
        );
      }

      const serviceFilter = {
        [Sequelize.Op.in]: serviceIds,
      };
      await queryInterface.bulkDelete(
        "service_availability",
        { service_id: serviceFilter },
        { transaction },
      );
      await queryInterface.bulkDelete(
        "service",
        { id: serviceFilter },
        { transaction },
      );
    });
  },
};

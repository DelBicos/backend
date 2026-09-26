jest.mock("../../../config/database", () => {
  const { Sequelize } = require("sequelize");
  const uri = process.env.PR2_TEST_DATABASE_URL;
  if (!uri)
    throw new Error(
      "Defina PR2_TEST_DATABASE_URL para um PostgreSQL local isolado (banco pr2_test).",
    );
  const url = new URL(uri);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/pr2_test"
  ) {
    throw new Error(
      "Testes destrutivos permitidos somente no banco local pr2_test.",
    );
  }
  return {
    sequelize: new Sequelize(uri, { logging: false, pool: { max: 8 } }),
  };
});
jest.mock("../../../models/Professional", () => ({
  ProfessionalModel: require("./sqlFixtures").defineSqlFixture("professional", {
    user_id: "int",
  }),
}));
jest.mock("../../../models/Service", () => ({
  ServiceModel: require("./sqlFixtures").defineSqlFixture("service", {
    professional_id: "int",
    duration: "int",
    active: "bool",
    title: "text",
  }),
}));
jest.mock("../../../models/Client", () => ({
  ClientModel: require("./sqlFixtures").defineSqlFixture("client", {
    user_id: "int",
    main_address_id: "int",
  }),
}));
jest.mock("../../../models/Appointment", () => ({
  AppointmentModel: require("./sqlFixtures").defineSqlFixture("appointment", {
    professional_id: "int",
    service_id: "int",
    client_id: "int",
    address_id: "int",
    short_id: "text",
    status: "text",
    start_time: "date",
    end_time: "date",
    payment_intent_id: "text",
    final_price: "number",
  }),
}));
jest.mock("../../../models/ProfessionalAvailability", () => ({
  ProfessionalAvailabilityModel: require("./sqlFixtures").defineSqlFixture(
    "availability",
    {
      professional_id: "int",
      start_time: "text",
      end_time: "text",
      is_available: "bool",
      recurrence_pattern: "text",
      start_day: "date",
      end_day: "date",
      days_of_week: "text",
      start_day_of_month: "int",
      end_day_of_month: "int",
    },
  ),
}));
jest.mock("../../../models/ServiceAvailability", () => ({
  ServiceAvailabilityModel: require("./sqlFixtures").defineSqlFixture(
    "service_availability",
    {
      service_id: "int",
      day_of_week: "int",
      start_time: "text",
      end_time: "text",
    },
  ),
}));
jest.mock("../../../models/ProfessionalAvailabilityLock", () => ({
  ProfessionalAvailabilityLockModel: require("./sqlFixtures").defineSqlFixture(
    "availability_lock",
    {
      professional_id: "int",
      start_time: "date",
      end_time: "date",
    },
  ),
}));
jest.mock("../../../models/User", () => ({
  UserModel: { findByPk: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../../../models/Notification", () => ({
  NotificationModel: { create: jest.fn(), bulkCreate: jest.fn() },
}));
jest.mock("../../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn() },
}));

import { sequelize } from "../../../config/database";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { ProfessionalAvailabilityModel } from "../../../models/ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel } from "../../../models/ProfessionalAvailabilityLock";
import { NotificationModel } from "../../../models/Notification";
import {
  createBotAppointment,
  rescheduleBotAppointment,
  resolveBotAppointmentStart,
} from "../../bot/states/appointmentActions";
import {
  createAppointmentWithScheduleLock,
  withProfessionalScheduleLock,
  changePendingAppointmentStatus,
  expirePendingAppointment,
} from "../../appointmentSchedule.service";
import { getAvailableSlots } from "../../availability.service";
import { BotSessionContext } from "../../../models/BotChatSession";

const date = "2099-01-05";
const context: BotSessionContext = {
  professionalId: 1,
  serviceId: 2,
  date,
  time: "09:00",
  timeZone: "Asia/Tokyo",
};
const reservation = {
  professional_id: 1,
  service_id: 2,
  client_id: 3,
  address_id: 4,
  start_time: new Date(`${date}T12:00:00Z`),
  end_time: new Date(`${date}T13:00:00Z`),
  status: "confirmed" as const,
  short_id: "ABC123",
  payment_intent_id: "pi_paid",
  final_price: 150,
};
async function original() {
  return AppointmentModel.create(reservation);
}
function rescheduleContext(id: number, time = "10:00"): BotSessionContext {
  return {
    ...context,
    appointmentId: id,
    pendingAction: "RESCHEDULE",
    newDate: date,
    newTime: time,
  };
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});
afterAll(async () => {
  await sequelize.close();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await sequelize.truncate();
  await ProfessionalModel.create({ id: 1, user_id: 20 } as any);
  await ClientModel.create({ id: 3, user_id: 10, main_address_id: 4 } as any);
  await ServiceModel.create({
    id: 2,
    professional_id: 1,
    duration: 60,
    active: true,
    title: "Limpeza",
  } as any);
  await ProfessionalAvailabilityModel.create({
    professional_id: 1,
    is_available: true,
    recurrence_pattern: "daily",
    start_time: "08:00",
    end_time: "18:00",
  });
});

it.each([undefined, `${date}T12:00:00.000Z`, `${date}T09:00:00-03:00`])(
  "grava o mesmo instante do contexto, independente do fuso informado: %s",
  async (iso) => {
    const result = await createBotAppointment(10, context, iso);
    expect(result.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  },
);

it.each([
  `${date}T13:00:00Z`,
  "2099-01-06T12:00:00Z",
  `${date}T09:00:00Z`,
  `${date}T09:00:00`,
  "inválido",
])("rejeita selected_time divergente/inválido sem gravar: %s", async (iso) => {
  await expect(createBotAppointment(10, context, iso)).rejects.toThrow(
    "não corresponde",
  );
  expect(await AppointmentModel.count()).toBe(0);
});

it("rejeita data passada e calendário inexistente", () => {
  expect(() => resolveBotAppointmentStart("2020-01-01", "09:00")).toThrow();
  expect(() => resolveBotAppointmentStart("2099-02-30", "09:00")).toThrow();
});

it("não permite usar um ISO livre para contornar um slot ocupado", async () => {
  await original();
  await expect(
    createBotAppointment(10, context, `${date}T13:00:00Z`),
  ).rejects.toThrow("não corresponde");
  await expect(
    createBotAppointment(10, context, `${date}T12:00:00Z`),
  ).rejects.toThrow("disponível");
  expect(await AppointmentModel.count()).toBe(1);
});

it("serializa duas criações simultâneas do bot em uma agenda vazia", async () => {
  const results = await Promise.allSettled([
    createBotAppointment(10, context),
    createBotAppointment(10, context),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(await AppointmentModel.count()).toBe(1);
});

it("serializa criação do bot contra criação convencional/pagamento com interseção parcial", async () => {
  const results = await Promise.allSettled([
    createBotAppointment(10, context),
    createAppointmentWithScheduleLock({
      ...reservation,
      payment_intent_id: null,
      start_time: new Date(`${date}T12:30Z`),
      end_time: new Date(`${date}T13:30Z`),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await AppointmentModel.count()).toBe(1);
});

it("remarca em interseção com o próprio horário sem mudar identidade, preço ou pagamento", async () => {
  const appt = await original();
  const result = await rescheduleBotAppointment(
    10,
    rescheduleContext(appt.id, "09:30"),
  );
  expect(result.id).toBe(appt.id);
  expect(result.start_time.toISOString()).toBe(`${date}T12:30:00.000Z`);
  expect(result.end_time.toISOString()).toBe(`${date}T13:30:00.000Z`);
  expect(result.payment_intent_id).toBe("pi_paid");
  expect(result.short_id).toBe("ABC123");
  expect(Number(result.final_price)).toBe(150);
  expect(result.status).toBe("pending");
  expect(await AppointmentModel.count()).toBe(1);
});

it("preserva a duração contratada mesmo após alteração do catálogo", async () => {
  const appt = await original();
  await ServiceModel.update({ duration: 90 }, { where: { id: 2 } });
  const result = await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(result.end_time.getTime() - result.start_time.getTime()).toBe(
    60 * 60000,
  );
});

it("mantém o original se o novo horário estiver ocupado e permite nova tentativa", async () => {
  const appt = await original();
  await AppointmentModel.create({
    ...reservation,
    payment_intent_id: null,
    start_time: new Date(`${date}T13:00Z`),
    end_time: new Date(`${date}T14:00Z`),
  });
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
  ).rejects.toThrow("disponível");
  await appt.reload();
  expect(appt.status).toBe("confirmed");
  expect(appt.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id, "11:00")),
  ).resolves.toMatchObject({ id: appt.id });
});

it("faz rollback real quando há falha depois do UPDATE e não notifica", async () => {
  const appt = await original();
  const save = AppointmentModel.prototype.save;
  jest
    .spyOn(AppointmentModel.prototype, "save")
    .mockImplementationOnce(async function (this: AppointmentModel, options) {
      await save.call(this, options);
      throw new Error("falha após update");
    });
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
  ).rejects.toThrow("falha após update");
  await appt.reload();
  expect(appt.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  expect(appt.status).toBe("confirmed");
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(NotificationModel.bulkCreate).not.toHaveBeenCalled();
});

it("repetir a confirmação mantém uma única reserva e não repete notificações", async () => {
  const appt = await original();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(await AppointmentModel.count()).toBe(1);
  expect(NotificationModel.bulkCreate).toHaveBeenCalledTimes(1);
});

it("protege remarcação contra criação concorrente no destino", async () => {
  const appt = await original();
  const results = await Promise.allSettled([
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
    createBotAppointment(10, { ...context, time: "10:00" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await AppointmentModel.count({
      where: { start_time: new Date(`${date}T13:00Z`) },
    }),
  ).toBe(1);
  expect((await AppointmentModel.findByPk(appt.id))?.status).not.toBe(
    "canceled",
  );
});

it("enxerga um bloqueio que foi confirmado antes de adquirir a agenda", async () => {
  let acquired!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = withProfessionalScheduleLock(1, async (transaction) => {
    await ProfessionalAvailabilityLockModel.create(
      {
        professional_id: 1,
        start_time: reservation.start_time,
        end_time: reservation.end_time,
      },
      { transaction },
    );
    acquired();
    await gate;
  });
  await ready;
  const booking = createBotAppointment(10, context);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const [rows] = await sequelize.query(
        "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%professional%'",
      );
      waiting = rows.length > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
  }
  await writer;
  await expect(booking).rejects.toThrow("disponível");
  expect(await AppointmentModel.count()).toBe(0);
});

it("aplica exclusão apenas ao ID original e mantém outras reservas bloqueando", async () => {
  const appt = await original();
  await AppointmentModel.create({
    ...reservation,
    payment_intent_id: null,
    start_time: new Date(`${date}T13:00Z`),
    end_time: new Date(`${date}T14:00Z`),
  });
  const slots = await getAvailableSlots(1, date, 60, 2, {
    excludeAppointmentId: appt.id,
  });
  expect(slots).toContain("09:00");
  expect(slots).not.toContain("09:30");
  expect(slots).not.toContain("10:00");
});

it("recusa remarcação de terceiro ou troca de serviço", async () => {
  const appt = await original();
  await expect(
    rescheduleBotAppointment(99, rescheduleContext(appt.id)),
  ).rejects.toThrow();
  await expect(
    rescheduleBotAppointment(10, {
      ...rescheduleContext(appt.id),
      serviceId: 999,
    }),
  ).rejects.toThrow("originais");
  await appt.reload();
  expect(appt.status).toBe("confirmed");
});

it("serializa confirmações repetidas do mesmo pagamento sem gerar conflito para estorno", async () => {
  const results = await Promise.all([
    createAppointmentWithScheduleLock(reservation),
    createAppointmentWithScheduleLock(reservation),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(await AppointmentModel.count()).toBe(1);
});

it("não aceita a data antiga quando o profissional confirma durante uma remarcação", async () => {
  const appt = await AppointmentModel.create({
    ...reservation,
    status: "pending",
  });
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await expect(
    changePendingAppointmentStatus(appt, "confirmed"),
  ).rejects.toThrow("alterado");
  await appt.reload();
  expect(appt.status).toBe("pending");
});

it("renova o prazo de aceite da reserva remarcada e revalida candidatos antigos do job", async () => {
  const appt = await original();
  const oldTimestamp = new Date(Date.now() - 24 * 3600000);
  await sequelize.query(
    "UPDATE appointment SET created_at = :old, updated_at = :old WHERE id = :id",
    { replacements: { old: oldTimestamp, id: appt.id } },
  );
  await appt.reload();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(
    await expirePendingAppointment(appt, new Date(Date.now() - 12 * 3600000)),
  ).toBe(false);
  await appt.reload();
  expect(appt.status).toBe("pending");
  expect(appt.createdAt.getTime()).toBe(oldTimestamp.getTime());
  expect(appt.payment_intent_id).toBe("pi_paid");
});

it("expira somente uma reserva que continua pendente e sem atualização por 12 horas", async () => {
  const appt = await AppointmentModel.create({
    ...reservation,
    status: "pending",
  });
  const oldTimestamp = new Date(Date.now() - 24 * 3600000);
  await sequelize.query(
    "UPDATE appointment SET updated_at = :old WHERE id = :id",
    { replacements: { old: oldTimestamp, id: appt.id } },
  );
  expect(
    await expirePendingAppointment(appt, new Date(Date.now() - 12 * 3600000)),
  ).toBe(true);
  await appt.reload();
  expect(appt.status).toBe("canceled");
});

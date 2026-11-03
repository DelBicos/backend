const mockPaymentRetrieve = jest.fn();
const mockDirectRefund = jest.fn();
jest.mock("../../../models/Address", () => ({
  AddressModel: require("./sqlFixtures").defineSqlFixture("address", {
    user_id: "int", active: "bool",
  }),
}));
jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  paymentIntents: { retrieve: mockPaymentRetrieve }, refunds: { create: mockDirectRefund },
})));
jest.mock("../../botAppointmentStatus.service", () => ({ syncBotSessionsForAppointmentStatus: jest.fn() }));
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
    price_cents: "int",
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
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../appointmentRefundProvider.service", () => ({ ensureAppointmentRefund: jest.fn() }));

import { sequelize } from "../../../config/database";
import type { CreationAttributes } from "sequelize";
import { AddressModel } from "../../../models/Address";
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
} from "../../bot/states/appointmentActions.service";
import {
  createAppointmentWithScheduleLock,
  withProfessionalScheduleLock,
  changePendingAppointmentStatus,
  expirePendingAppointment,
} from "../../appointmentSchedule.service";
import { getAvailableSlots } from "../../availability.service";
import { BotSessionContext } from "../../../models/BotChatSession";
import { AppointmentRefundModel } from "../../../models/AppointmentRefund";
import { processAppointmentRefunds } from "../../appointmentRefund.service";
import { ensureAppointmentRefund } from "../../appointmentRefundProvider.service";
import { ensureChatRoomForAppointment } from "../../../utils/chatRoom";
import { UserModel } from "../../../models/User";
import { syncBotSessionsForAppointmentStatus } from "../../botAppointmentStatus.service";
let paymentService: typeof import("../../payment.service").PaymentService;
const previousStripeKey = process.env.STRIPE_SECRET_KEY;

const date = "2099-01-05";
const context: BotSessionContext = {
  addressId: 4,
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
  // Exercita também a migration real, em vez de depender apenas de sync().
  const migration = require("../../../../migrations/20260926120000-create-appointment-refund");
  await migration.down(sequelize.getQueryInterface());
  await migration.up(sequelize.getQueryInterface(), require("sequelize"));
  const nullableMigration = require("../../../../migrations/20260926121000-allow-unlinked-appointment-refund");
  await nullableMigration.up(sequelize.getQueryInterface(), require("sequelize"));
  await nullableMigration.down(sequelize.getQueryInterface(), require("sequelize"));
  await nullableMigration.up(sequelize.getQueryInterface(), require("sequelize"));
  process.env.STRIPE_SECRET_KEY = "sk_test_integration_mock";
  paymentService = require("../../payment.service").PaymentService;
});
afterAll(async () => {
  await sequelize.close();
  if (previousStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = previousStripeKey;
});
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await sequelize.truncate({ cascade: true });
  (ensureAppointmentRefund as jest.Mock).mockReset().mockResolvedValue(true);
  mockPaymentRetrieve.mockReset();
  mockDirectRefund.mockReset();
  (NotificationModel.create as jest.Mock).mockReset();
  (ensureChatRoomForAppointment as jest.Mock).mockReset();
  (syncBotSessionsForAppointmentStatus as jest.Mock).mockReset();
  (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 10 });
  await ProfessionalModel.create({ id: 1, user_id: 20 } as CreationAttributes<ProfessionalModel>);
  await ClientModel.create({ id: 3, user_id: 10, main_address_id: 4 } as CreationAttributes<ClientModel>);
  await AddressModel.create({ id: 4, user_id: 10, active: true } as CreationAttributes<AddressModel>);
  await ServiceModel.create({
    id: 2,
    professional_id: 1,
    duration: 60,
    active: true,
    title: "Limpeza",
    price_cents: 15000,
  } as CreationAttributes<ServiceModel>);
  await ProfessionalAvailabilityModel.create({
    professional_id: 1,
    is_available: true,
    recurrence_pattern: "daily",
    start_time: "08:00",
    end_time: "18:00",
  });
});

async function expiredPaidReservation() {
  const appt = await original();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await sequelize.query("UPDATE appointment SET updated_at = :old WHERE id = :id", {
    replacements: { old: new Date(Date.now() - 24 * 3600000), id: appt.id },
  });
  return appt;
}

function paidIntent(appointmentId?: number, amount = 15000) {
  mockPaymentRetrieve.mockResolvedValue({
    id: "pi_paid", status: "succeeded", amount, amount_received: amount,
    metadata: { professionalId: "1", serviceId: "2", addressId: "4",
      selectedTime: `${date}T12:00:00Z`,
      ...(appointmentId ? { appointmentId: String(appointmentId) } : {}),
    },
  });
}

async function unpaidReschedule() {
  const appt = await AppointmentModel.create({ ...reservation, payment_intent_id: null });
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  paidIntent(appt.id);
  return appt;
}

async function expectWaitingForScheduleLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [rows] = await sequelize.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%professional%'",
    );
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("A operação concorrente não aguardou a trava da agenda");
}


export { sequelize, AppointmentModel, ClientModel, ProfessionalModel, ServiceModel, ProfessionalAvailabilityModel, ProfessionalAvailabilityLockModel, NotificationModel, createBotAppointment, rescheduleBotAppointment, resolveBotAppointmentStart, createAppointmentWithScheduleLock, withProfessionalScheduleLock, changePendingAppointmentStatus, expirePendingAppointment, getAvailableSlots, AppointmentRefundModel, processAppointmentRefunds, ensureAppointmentRefund, ensureChatRoomForAppointment, UserModel, syncBotSessionsForAppointmentStatus, paymentService, mockPaymentRetrieve, mockDirectRefund, date, context, reservation, original, rescheduleContext, expiredPaidReservation, paidIntent, unpaidReschedule, expectWaitingForScheduleLock };

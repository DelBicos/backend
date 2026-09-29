jest.mock("../../models/ProfessionalAvailability", () => ({
  ProfessionalAvailabilityModel: { findAll: jest.fn() },
}));
jest.mock("../../models/ProfessionalAvailabilityLock", () => ({
  ProfessionalAvailabilityLockModel: { findAll: jest.fn() },
}));
jest.mock("../../models/ServiceAvailability", () => ({
  ServiceAvailabilityModel: { findAll: jest.fn() },
}));
jest.mock("../../models/Service", () => ({
  ServiceModel: { findAll: jest.fn() },
}));
jest.mock("../../models/Appointment", () => ({
  AppointmentModel: { findAll: jest.fn() },
}));

import { Op } from "sequelize";
import { getAvailableSlots, ruleAppliesOnDate } from "../availability.service";
import { ProfessionalAvailabilityModel as Rules } from "../../models/ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel as Locks } from "../../models/ProfessionalAvailabilityLock";
import { ServiceAvailabilityModel as ServiceRules } from "../../models/ServiceAvailability";
import { AppointmentModel as Appointments } from "../../models/Appointment";

const date = "2030-01-07"; // segunda
const rule = {
  is_available: true,
  recurrence_pattern: "weekly",
  days_of_week: "0100000",
  start_time: "09:00:00",
  end_time: "14:00:00",
};

beforeEach(() => {
  jest.clearAllMocks();
  (Rules.findAll as jest.Mock).mockResolvedValue([rule]);
  (Locks.findAll as jest.Mock).mockResolvedValue([]);
  (ServiceRules.findAll as jest.Mock).mockResolvedValue([]);
  (Appointments.findAll as jest.Mock).mockResolvedValue([]);
});

it("bloqueia 09h e 09h30 locais para uma reserva 12h–13h UTC, liberando 12h local", async () => {
  (Appointments.findAll as jest.Mock).mockResolvedValue([
    { start_time: "2030-01-07T12:00:00Z", end_time: "2030-01-07T13:00:00Z" },
  ]);
  const slots = await getAvailableSlots(1, date, 30, 2);
  expect(slots).not.toContain("09:00");
  expect(slots).not.toContain("09:30");
  expect(slots).toEqual(expect.arrayContaining(["10:00", "12:00"]));
});

it("consulta interseções no dia de São Paulo, incluindo reservas iniciadas no dia anterior", async () => {
  (Rules.findAll as jest.Mock).mockResolvedValue([
    { ...rule, start_time: "00:00", end_time: "02:00" },
  ]);
  (Appointments.findAll as jest.Mock).mockResolvedValue([
    { start_time: "2030-01-07T02:00:00Z", end_time: "2030-01-07T03:30:00Z" },
  ]);
  expect(
    await getAvailableSlots(1, date, 30, 2, { excludeAppointmentId: 8 }),
  ).toEqual(["00:30", "01:00", "01:30"]);
  const query = (Appointments.findAll as jest.Mock).mock.calls[0][0];
  expect(query.where.start_time[Op.lt].toISOString()).toBe(
    "2030-01-08T03:00:00.000Z",
  );
  expect(query.where.end_time[Op.gt].toISOString()).toBe(
    "2030-01-07T03:00:00.000Z",
  );
  expect(query.where.id[Op.ne]).toBe(8);
});

it("combina bloqueios recorrentes, pontuais e explícitos e respeita a duração", async () => {
  (Rules.findAll as jest.Mock).mockResolvedValue([
    rule,
    {
      ...rule,
      is_available: false,
      recurrence_pattern: "daily",
      start_time: "10:00",
      end_time: "11:00",
    },
    {
      ...rule,
      is_available: false,
      recurrence_pattern: "none",
      start_day: new Date("2030-01-07T00:00Z"),
      end_day: new Date("2030-01-07T00:00Z"),
      start_time: "12:00",
      end_time: "13:00",
    },
  ]);
  (Locks.findAll as jest.Mock).mockResolvedValue([
    { start_time: "2030-01-07T16:00Z", end_time: "2030-01-07T17:00Z" },
  ]);
  expect(await getAvailableSlots(1, date, 60, 2)).toEqual(["09:00", "11:00"]);
});

it.each([
  [{ recurrence_pattern: "daily" }, true],
  [{ recurrence_pattern: "weekly", days_of_week: "0010000" }, false],
  [
    {
      recurrence_pattern: "monthly",
      start_day_of_month: 7,
      end_day_of_month: 7,
    },
    true,
  ],
  [
    {
      recurrence_pattern: "monthly",
      start_day_of_month: 8,
      end_day_of_month: 15,
    },
    false,
  ],
  [{ recurrence_pattern: "daily", end_day: "2030-01-06" }, false],
  [{ recurrence_pattern: "daily", start_day: "2030-01-08" }, false],
])("aplica recorrência e limites de calendário: %j", (override, expected) => {
  expect(ruleAppliesOnDate({ ...rule, ...override } as any, date)).toBe(
    expected,
  );
});

it("une horários profissionais e do serviço sem duplicar ou exceder o fim", async () => {
  (ServiceRules.findAll as jest.Mock).mockResolvedValue([
    { start_time: "09:00", end_time: "10:00" },
  ]);
  const slots = await getAvailableSlots(1, date, 60, 2);
  expect(slots.filter((slot) => slot === "09:00")).toHaveLength(1);
  expect(slots).not.toContain("13:30");
});

it.each([
  ["2030-02-30", 30],
  [date, 0],
  [date, -30],
])("rejeita calendário/duração inválidos: %s %s", async (day, duration) => {
  expect(await getAvailableSlots(1, day, duration, 2)).toEqual([]);
});

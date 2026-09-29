jest.mock("../../config/database");
jest.mock("../../models/ProfessionalAvailability");
jest.mock("../../models/ServiceAvailability");
jest.mock("../../models/Service");
jest.mock("../../models/Appointment");

import { ProfessionalAvailabilityModel } from "../../models/ProfessionalAvailability";
import { ServiceAvailabilityModel } from "../../models/ServiceAvailability";
import { AppointmentModel } from "../../models/Appointment";
import { ServiceModel } from "../../models/Service";
import { assertSlotInAgenda, getAvailableSlots } from "../availability.service";

const mocked = (fn: unknown) => fn as jest.Mock;

/** 2030-02-04 e uma segunda-feira. */
const MONDAY = "2030-02-04";

beforeEach(() => {
  jest.clearAllMocks();
  mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([]);
  mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([]);
  mocked(AppointmentModel.findAll).mockResolvedValue([]);
  mocked(ServiceModel.findAll).mockResolvedValue([]);
});

describe("getAvailableSlots", () => {
  it("gera horarios de 30 em 30 min dentro da regra, respeitando a duracao", async () => {
    mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([
      { start_time: "09:00", end_time: "11:00" },
    ]);
    expect(await getAvailableSlots(20, MONDAY, 60, 40)).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("nao oferece horario ocupado por outro agendamento", async () => {
    mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([
      { start_time: "09:00", end_time: "12:00" },
    ]);
    mocked(AppointmentModel.findAll).mockResolvedValue([
      { start_time: new Date(`${MONDAY}T10:00:00Z`), end_time: new Date(`${MONDAY}T11:00:00Z`) },
    ]);
    expect(await getAvailableSlots(20, MONDAY, 60, 40)).toEqual(["09:00", "11:00"]);
  });

  it("ignora o proprio agendamento ao reagendar", async () => {
    mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([
      { start_time: "09:00", end_time: "11:00" },
    ]);
    await getAvailableSlots(20, MONDAY, 60, 40, 77);
    const where = mocked(AppointmentModel.findAll).mock.calls[0][0].where;
    expect(Object.getOwnPropertySymbols(where.id ?? {}).length).toBe(1);
  });
});

describe("assertSlotInAgenda", () => {
  beforeEach(() => {
    mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([
      { start_time: "09:00", end_time: "12:00" },
    ]);
  });

  it("aceita um horario da agenda", async () => {
    await expect(
      assertSlotInAgenda({
        professionalId: 20,
        start: new Date(`${MONDAY}T10:00:00Z`),
        durationMinutes: 60,
        serviceId: 40,
      }),
    ).resolves.toBeUndefined();
  });

  it("recusa (409) horario fora da agenda, sem trocar de dia nem de regra", async () => {
    for (const start of [`${MONDAY}T08:00:00Z`, `${MONDAY}T11:30:00Z`, `${MONDAY}T10:15:00Z`]) {
      await expect(
        assertSlotInAgenda({
          professionalId: 20,
          start: new Date(start),
          durationMinutes: 60,
          serviceId: 40,
        }),
      ).rejects.toMatchObject({ status: 409 });
    }
  });

  it("recusa quando o profissional nao publicou nenhuma agenda", async () => {
    mocked(ServiceAvailabilityModel.findAll).mockResolvedValue([]);
    await expect(
      assertSlotInAgenda({
        professionalId: 20,
        start: new Date(`${MONDAY}T10:00:00Z`),
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/ProfessionalAvailability");
jest.mock("../../../models/ProfessionalAvailabilityLock");
jest.mock("../../../models/Professional");

import { ProfessionalAvailabilityModel } from "../../../models/ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel } from "../../../models/ProfessionalAvailabilityLock";
import { ProfessionalModel } from "../../../models/Professional";
import * as availability from "../availability.service";
import * as locks from "../availabilityLock.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const windowRow = (overrides: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = {
    id: 1,
    professional_id: 20,
    recurrence_pattern: "weekly",
    days_of_week: "0111110",
    start_time: "08:00",
    end_time: "12:00",
    is_available: true,
    ...overrides,
  };
  return { ...data, update: jest.fn(), save: jest.fn(), toJSON: () => ({ ...data }) } as any;
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 9 });
});

describe("weekdaysIntersect", () => {
  it("detecta dias em comum", () => {
    expect(availability.weekdaysIntersect("0100000", "0110000")).toBe(true);
    expect(availability.weekdaysIntersect("1000000", "0000001")).toBe(false);
    expect(availability.weekdaysIntersect(null, "0000001")).toBe(true);
  });
});

describe("hasOverlap", () => {
  it("ignora janelas desativadas e a propria janela em edicao", async () => {
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([]);
    await availability.hasOverlap(
      20,
      { start_time: "08:00", end_time: "10:00", recurrence_pattern: "none" },
      7,
    );
    const where = mocked(ProfessionalAvailabilityModel.findAll).mock.calls[0][0].where;
    expect(where.is_available).toBe(true);
    expect(where.id).toBeDefined();
  });

  it("semanal: so conflita se houver dia da semana em comum", async () => {
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([
      windowRow({ days_of_week: "1000000" }),
    ]);
    const base = { start_time: "09:00", end_time: "10:00", recurrence_pattern: "weekly" };
    await expect(
      availability.hasOverlap(20, { ...base, days_of_week: "0000001" }),
    ).resolves.toBe(false);
    await expect(
      availability.hasOverlap(20, { ...base, days_of_week: "1000000" }),
    ).resolves.toBe(true);
  });
});

describe("create / update / disable", () => {
  const body = {
    recurrence_pattern: "weekly",
    days_of_week: "0100000",
    start_time: "09:00",
    end_time: "11:00",
  };

  it("so o dono cria disponibilidade", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 999 });
    await expectHttpError(availability.create(9, "20", body), 403);
  });

  it("recusa janela sobreposta (409)", async () => {
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([windowRow()]);
    await expectHttpError(availability.create(9, "20", body), 409);
  });

  it("cria com valores padrao", async () => {
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([]);
    mocked(ProfessionalAvailabilityModel.create).mockImplementation(async (d: any) => d);
    const created: any = await availability.create(9, "20", body);
    expect(created).toMatchObject({ professional_id: 20, is_available: true, start_day: null });
  });

  it("update tambem valida sobreposicao (antes so o create validava)", async () => {
    const current = windowRow({ id: 5 });
    mocked(ProfessionalAvailabilityModel.findOne).mockResolvedValue(current);
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([windowRow({ id: 6 })]);

    await expectHttpError(availability.update(9, "5", { start_time: "07:00" }), 409);
    expect(current.update).not.toHaveBeenCalled();
  });

  it("update aplica apenas campos permitidos", async () => {
    const current = windowRow({ id: 5 });
    mocked(ProfessionalAvailabilityModel.findOne).mockResolvedValue(current);
    mocked(ProfessionalAvailabilityModel.findAll).mockResolvedValue([]);

    await availability.update(9, "5", { end_time: "13:00", professional_id: 1 });

    expect(current.update).toHaveBeenCalledWith({ end_time: "13:00" });
  });

  it("rota aninhada restringe ao professionalId informado", async () => {
    mocked(ProfessionalAvailabilityModel.findOne).mockResolvedValue(null);
    await expectHttpError(availability.get("5", "21"), 404);
    expect(mocked(ProfessionalAvailabilityModel.findOne).mock.calls[0][0].where).toEqual({
      id: 5,
      professional_id: 21,
    });
  });

  it("disable faz desativacao logica", async () => {
    const current = windowRow();
    mocked(ProfessionalAvailabilityModel.findOne).mockResolvedValue(current);
    await availability.disable(9, "1");
    expect(current.is_available).toBe(false);
    expect(current.save).toHaveBeenCalled();
  });
});

describe("bloqueios de agenda", () => {
  it("valida o periodo do bloqueio", async () => {
    await expectHttpError(
      locks.create(9, "20", { start_time: "2026-10-10T10:00:00Z", end_time: "2026-10-10T09:00:00Z" }),
      400,
    );
  });

  it("cria bloqueio registrando o autor", async () => {
    mocked(ProfessionalAvailabilityLockModel.create).mockImplementation(async (d: any) => d);
    const lock: any = await locks.create(9, "20", {
      start_time: "2026-10-10T09:00:00Z",
      end_time: "2026-10-10T12:00:00Z",
      reason: "Consulta",
    });
    expect(lock).toMatchObject({ professional_id: 20, created_by: 9, reason: "Consulta" });
  });

  it("so o dono remove o bloqueio", async () => {
    const lock = { professional_id: 20, destroy: jest.fn() };
    mocked(ProfessionalAvailabilityLockModel.findByPk).mockResolvedValue(lock);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 999 });
    await expectHttpError(locks.remove(9, "3"), 403);
    expect(lock.destroy).not.toHaveBeenCalled();
  });
});

jest.mock("../../config/database");
jest.mock("../../models/Professional");
jest.mock("../../models/Appointment");
jest.mock("../../models/ProfessionalAvailabilityLock");
jest.mock("../../models/Service");
jest.mock("../availability.service", () => ({
  appointmentOverlapWhere: jest.fn(() => ({ overlap: true })),
}));
jest.mock("../appointmentRefund.service", () => ({
  enqueueAppointmentRefund: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { Transaction } from "sequelize";
import { sequelize } from "../../config/database";
import { HttpError } from "../../errors/HttpError";
import { AppointmentModel, IAppointment } from "../../models/Appointment";
import { ProfessionalModel } from "../../models/Professional";
import { ProfessionalAvailabilityLockModel } from "../../models/ProfessionalAvailabilityLock";
import { ServiceModel } from "../../models/Service";
import { appointmentOverlapWhere } from "../availability.service";
import { enqueueAppointmentRefund } from "../appointmentRefund.service";
import {
  ScheduleConflictError,
  assertNoAppointmentOverlap,
  changePendingAppointmentStatus,
  createAppointmentWithScheduleLock,
  expirePendingAppointment,
  withProfessionalScheduleLock,
} from "../appointmentSchedule.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const tx = { LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction;
const START = new Date("2030-01-10T12:00:00.000Z");
const END = new Date("2030-01-10T13:00:00.000Z");

const transactionSpy = jest.spyOn(sequelize, "transaction");

const makeData = (overrides: Partial<IAppointment> = {}) =>
  ({
    client_id: 1,
    professional_id: 2,
    service_id: 3,
    start_time: START,
    end_time: END,
    status: "pending",
    ...overrides,
  }) as unknown as IAppointment;

const makeAppt = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 10,
    professional_id: 2,
    status: "pending",
    start_time: START,
    updatedAt: new Date("2030-01-09T10:00:00.000Z"),
    save: jest.fn(),
    ...overrides,
  }) as unknown as AppointmentModel;

beforeEach(() => {
  transactionSpy.mockImplementation((async (
    _options: unknown,
    work: (t: Transaction) => Promise<unknown>,
  ) => work(tx)) as unknown as typeof sequelize.transaction);
  mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 2 });
  mocked(AppointmentModel.findOne).mockResolvedValue(null);
  mocked(ProfessionalAvailabilityLockModel.findOne).mockResolvedValue(null);
});

describe("ScheduleConflictError", () => {
  it("e um HttpError 409 com codigo estavel", () => {
    const error = new ScheduleConflictError("conflito");
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("SCHEDULE_CONFLICT");
    expect(error.name).toBe("ScheduleConflictError");
  });
});

describe("withProfessionalScheduleLock", () => {
  it("trava o profissional em READ COMMITTED e executa o trabalho", async () => {
    const work = jest.fn(async () => "ok");

    await expect(withProfessionalScheduleLock(2, work)).resolves.toBe("ok");

    expect(transactionSpy).toHaveBeenCalledWith(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      expect.any(Function),
    );
    expect(ProfessionalModel.findByPk).toHaveBeenCalledWith(2, {
      transaction: tx,
      lock: "UPDATE",
    });
    expect(work).toHaveBeenCalledWith(tx);
  });

  it("recusa com 404 quando o profissional nao existe", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(null);
    const work = jest.fn();

    await expect(withProfessionalScheduleLock(2, work)).rejects.toMatchObject({
      status: 404,
    });
    expect(work).not.toHaveBeenCalled();
  });
});

describe("assertNoAppointmentOverlap", () => {
  it.each([
    ["inicio invalido", new Date("x"), END],
    ["fim invalido", START, new Date("x")],
    ["fim antes do inicio", END, START],
    ["intervalo vazio", START, START],
  ])("recusa %s", async (_label, start, end) => {
    await expect(assertNoAppointmentOverlap(2, start, end, tx)).rejects.toThrow(
      "Intervalo de agendamento inválido",
    );
    expect(AppointmentModel.findOne).not.toHaveBeenCalled();
  });

  it("passa quando nao ha agendamento nem bloqueio no intervalo", async () => {
    await expect(assertNoAppointmentOverlap(2, START, END, tx, 7)).resolves.toBeUndefined();

    expect(appointmentOverlapWhere).toHaveBeenCalledWith(2, START, END, 7);
    expect(AppointmentModel.findOne).toHaveBeenCalledWith({
      where: { overlap: true },
      transaction: tx,
    });
    expect(ProfessionalAvailabilityLockModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: tx }),
    );
  });

  it("recusa quando ja existe agendamento sobreposto", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue({ id: 99 });

    await expect(assertNoAppointmentOverlap(2, START, END, tx)).rejects.toBeInstanceOf(
      ScheduleConflictError,
    );
  });

  it("recusa quando o profissional bloqueou o horario", async () => {
    mocked(ProfessionalAvailabilityLockModel.findOne).mockResolvedValue({ id: 5 });

    await expect(assertNoAppointmentOverlap(2, START, END, tx)).rejects.toThrow(
      "Horário não está mais disponível",
    );
  });
});

describe("createAppointmentWithScheduleLock", () => {
  beforeEach(() => {
    mocked(ServiceModel.findByPk).mockResolvedValue({ active: true, professional_id: 2 });
    mocked(AppointmentModel.create).mockResolvedValue({ id: 50 });
  });

  it("cria o agendamento dentro da transacao quando o horario esta livre", async () => {
    const data = makeData();

    await expect(createAppointmentWithScheduleLock(data)).resolves.toEqual({ id: 50 });

    expect(ServiceModel.findByPk).toHaveBeenCalledWith(3, { transaction: tx });
    expect(AppointmentModel.create).toHaveBeenCalledWith(data, { transaction: tx });
  });

  it("devolve o agendamento existente quando o mesmo pagamento e confirmado de novo", async () => {
    const paid = { id: 40, client_id: 1, service_id: 3, professional_id: 2 };
    mocked(AppointmentModel.findOne).mockResolvedValueOnce(paid);

    await expect(
      createAppointmentWithScheduleLock(makeData({ payment_intent_id: "pi_1" })),
    ).resolves.toBe(paid);

    expect(AppointmentModel.findOne).toHaveBeenCalledWith({
      where: { payment_intent_id: "pi_1" },
      transaction: tx,
    });
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("recusa pagamento ja vinculado a outro agendamento", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValueOnce({
      id: 40,
      client_id: 9,
      service_id: 3,
      professional_id: 2,
    });

    await expect(
      createAppointmentWithScheduleLock(makeData({ payment_intent_id: "pi_1" })),
    ).rejects.toThrow("Pagamento já vinculado a outro agendamento");
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("segue para a criacao quando o pagamento ainda nao foi usado", async () => {
    await createAppointmentWithScheduleLock(makeData({ payment_intent_id: "pi_2" }));

    expect(AppointmentModel.create).toHaveBeenCalled();
  });

  it.each([
    ["inexistente", null],
    ["inativo", { active: false, professional_id: 2 }],
    ["de outro profissional", { active: true, professional_id: 8 }],
  ])("recusa servico %s", async (_label, service) => {
    mocked(ServiceModel.findByPk).mockResolvedValue(service);

    await expect(createAppointmentWithScheduleLock(makeData())).rejects.toThrow(
      "Serviço inativo ou não pertence ao profissional",
    );
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("recusa quando o horario ja esta ocupado", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue({ id: 99 });

    await expect(createAppointmentWithScheduleLock(makeData())).rejects.toBeInstanceOf(
      ScheduleConflictError,
    );
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });
});

describe("changePendingAppointmentStatus", () => {
  it("confirma o agendamento pendente sem estornar", async () => {
    const current = makeAppt();
    mocked(AppointmentModel.findByPk).mockResolvedValue(current);
    const appointment = makeAppt({ save: undefined });

    await changePendingAppointmentStatus(appointment, "confirmed");

    expect(AppointmentModel.findByPk).toHaveBeenCalledWith(10, {
      transaction: tx,
      lock: "UPDATE",
    });
    expect(current.status).toBe("confirmed");
    expect(current.save).toHaveBeenCalledWith({ transaction: tx });
    expect(enqueueAppointmentRefund).not.toHaveBeenCalled();
    expect(appointment.status).toBe("confirmed");
  });

  it("cancela o agendamento pendente e enfileira o estorno", async () => {
    const current = makeAppt();
    mocked(AppointmentModel.findByPk).mockResolvedValue(current);
    const appointment = makeAppt();

    await changePendingAppointmentStatus(appointment, "canceled");

    expect(current.status).toBe("canceled");
    expect(enqueueAppointmentRefund).toHaveBeenCalledWith(current, tx);
    expect(appointment.status).toBe("canceled");
  });

  it.each([
    ["sumiu", null],
    ["ja foi confirmado", makeAppt({ status: "confirmed" })],
    ["foi remarcado", makeAppt({ start_time: new Date("2030-01-11T12:00:00.000Z") })],
  ])("recusa quando o agendamento %s", async (_label, current) => {
    mocked(AppointmentModel.findByPk).mockResolvedValue(current);
    const appointment = makeAppt();

    await expect(changePendingAppointmentStatus(appointment, "confirmed")).rejects.toThrow(
      "O agendamento foi alterado",
    );
    expect(appointment.status).toBe("pending");
  });
});

describe("expirePendingAppointment", () => {
  const deadline = new Date("2030-01-09T12:00:00.000Z");

  it("cancela o pendente cujo prazo de aceite venceu e enfileira o estorno", async () => {
    const current = makeAppt();
    mocked(AppointmentModel.findByPk).mockResolvedValue(current);
    const appointment = makeAppt();

    await expect(expirePendingAppointment(appointment, deadline)).resolves.toBe(true);

    expect(current.status).toBe("canceled");
    expect(current.save).toHaveBeenCalledWith({ transaction: tx });
    expect(enqueueAppointmentRefund).toHaveBeenCalledWith(current, tx);
    expect(appointment.status).toBe("canceled");
  });

  it.each([
    ["sumiu", null],
    ["nao esta mais pendente", makeAppt({ status: "confirmed" })],
    ["foi remarcado depois do prazo", makeAppt({ updatedAt: new Date("2030-01-09T13:00:00.000Z") })],
  ])("nao expira quando o agendamento %s", async (_label, current) => {
    mocked(AppointmentModel.findByPk).mockResolvedValue(current);
    const appointment = makeAppt();

    await expect(expirePendingAppointment(appointment, deadline)).resolves.toBe(false);

    expect(enqueueAppointmentRefund).not.toHaveBeenCalled();
    expect(appointment.status).toBe("pending");
  });
});

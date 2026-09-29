import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Appointment");
jest.mock("../../../models/Client");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Service");
jest.mock("../../../utils/chatRoom", () => ({ syncChatRoomStatusForAppointment: jest.fn() }));
jest.mock("../../botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../payment.service", () => ({
  servicePriceInCents: jest.fn(() => 10000),
  PaymentService: {
    getPaidAmountCents: jest.fn(),
    settleWithRetention: jest.fn(),
  },
}));
jest.mock("../../availability.service", () => ({
  getAvailableSlots: jest.fn(),
  assertSlotInAgenda: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../appointment.service", () => ({
  findAppointmentByPublicId: jest.fn(),
  assertProfessionalIsFree: jest.fn(),
  toPublicAppointment: jest.fn((a: any) => ({ id: a.short_id, status: a.status })),
}));
jest.mock("../appointment.notifications", () => ({
  notifyAppointmentCanceled: jest.fn(),
  notifyNoShow: jest.fn(),
  notifyRescheduleRequested: jest.fn(),
  notifyRescheduleAnswered: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { ProfessionalModel } from "../../../models/Professional";
import { PaymentService } from "../../payment.service";
import * as appointmentService from "../appointment.service";
import * as notifications from "../appointment.notifications";
import { getAvailableSlots } from "../../availability.service";
import * as lifecycle from "../appointment.lifecycle";

const mocked = (fn: unknown) => fn as jest.Mock;

const CLIENT_USER = 1;
const PRO_USER = 2;
const NOW = new Date("2030-01-10T12:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const make = (overrides: Record<string, unknown> = {}) => {
  const appt: any = {
    id: 10,
    short_id: "ABC123",
    status: "confirmed",
    professional_id: 20,
    payment_intent_id: "pi_1",
    start_time: inHours(48),
    end_time: inHours(49),
    Client: { id: 30, user_id: CLIENT_USER },
    Professional: { id: 20, user_id: PRO_USER },
    Service: { id: 40, title: "Limpeza", duration: 60, price: 100 },
    reschedule_requested_start: null,
    reschedule_requested_by: null,
    save: jest.fn(),
    ...overrides,
  };
  mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(appt);
  return appt;
};

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(() => undefined, (e) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const split = (retained: number, refunded: number) => ({
  status: "ok",
  paidCents: retained + refunded,
  retainedCents: retained,
  refundedCents: refunded,
});

beforeEach(() => jest.clearAllMocks());

describe("cancelAppointment", () => {
  it("cliente com mais de 24h: sem retencao", async () => {
    const appt = make();
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(0, 10000));

    const result = await lifecycle.cancelAppointment(CLIENT_USER, "ABC123", "Mudei de planos", NOW);

    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 0);
    expect(appt.status).toBe("canceled");
    expect(appt.canceled_by).toBe("client");
    expect(appt.cancellation_reason).toBe("Mudei de planos");
    expect(result).toMatchObject({ tier: "free", retainedCents: 0, refundedCents: 10000 });
    expect(notifications.notifyAppointmentCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: PRO_USER, canceledBy: "client" }),
    );
  });

  it("cliente entre 24h e 2h: retem 20%", async () => {
    make({ start_time: inHours(10) });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(2000, 8000));
    const result = await lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW);
    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 20);
    expect(result).toMatchObject({ tier: "mid", retainedCents: 2000 });
  });

  it("cliente com menos de 2h: retem 30%", async () => {
    make({ start_time: inHours(1) });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(3000, 7000));
    await lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW);
    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 30);
  });

  it("pedido pendente: libera a reserva sem reter nada, mesmo em cima da hora", async () => {
    make({ status: "pending", start_time: inHours(1) });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(0, 10000));
    await lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW);
    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 0);
  });

  it("profissional cancela confirmado: reembolso total e marca na reputacao", async () => {
    make({ start_time: inHours(1) });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(0, 10000));

    const result = await lifecycle.cancelAppointment(PRO_USER, "ABC123", undefined, NOW);

    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 0);
    expect(result.tier).toBe("full_refund");
    expect(ProfessionalModel.increment).toHaveBeenCalledWith("cancellations_count", {
      where: { id: 20 },
    });
    expect(notifications.notifyAppointmentCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: CLIENT_USER }),
    );
  });

  it("profissional cancelando pedido ainda pendente nao conta na reputacao", async () => {
    make({ status: "pending" });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(0, 10000));
    await lifecycle.cancelAppointment(PRO_USER, "ABC123", undefined, NOW);
    expect(ProfessionalModel.increment).not.toHaveBeenCalled();
  });

  it("agendamento sem pagamento online cancela sem tocar no Stripe", async () => {
    const appt = make({ payment_intent_id: null });
    await lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW);
    expect(PaymentService.settleWithRetention).not.toHaveBeenCalled();
    expect(appt.status).toBe("canceled");
  });

  it("se o pagamento falhar, nada e cancelado (502)", async () => {
    const appt = make();
    mocked(PaymentService.settleWithRetention).mockResolvedValue({
      status: "failed",
      paidCents: 0,
      retainedCents: 0,
      refundedCents: 0,
    });
    await expectHttpError(lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW), 502);
    expect(appt.status).toBe("confirmed");
    expect(appt.save).not.toHaveBeenCalled();
  });

  it("terceiros nao podem cancelar (403)", async () => {
    make();
    await expectHttpError(lifecycle.cancelAppointment(999, "ABC123", undefined, NOW), 403);
  });

  it("nao cancela depois do inicio nem status finais", async () => {
    make({ start_time: inHours(-1) });
    await expectHttpError(lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW), 400);
    make({ status: "completed" });
    await expectHttpError(lifecycle.cancelAppointment(CLIENT_USER, "ABC123", undefined, NOW), 400);
  });

  it("limita o tamanho do motivo", async () => {
    make();
    await expectHttpError(
      lifecycle.cancelAppointment(CLIENT_USER, "ABC123", "x".repeat(501), NOW),
      400,
    );
  });
});

describe("previewCancellation", () => {
  it("mostra os valores sem cancelar nada", async () => {
    const appt = make({ start_time: inHours(10) });
    mocked(PaymentService.getPaidAmountCents).mockResolvedValue(10000);
    const out = await lifecycle.previewCancellation(CLIENT_USER, "ABC123", NOW);
    expect(out).toMatchObject({ tier: "mid", retainedCents: 2000, refundCents: 8000 });
    expect(appt.save).not.toHaveBeenCalled();
    expect(PaymentService.settleWithRetention).not.toHaveBeenCalled();
  });
});

describe("markNoShow", () => {
  it("retem 100% depois da tolerancia", async () => {
    const appt = make({ start_time: inHours(-1) });
    mocked(PaymentService.settleWithRetention).mockResolvedValue(split(10000, 0));

    await lifecycle.markNoShow(PRO_USER, "ABC123", NOW);

    expect(PaymentService.settleWithRetention).toHaveBeenCalledWith("pi_1", 100);
    expect(appt.status).toBe("no_show");
    expect(appt.retained_cents).toBe(10000);
    expect(notifications.notifyNoShow).toHaveBeenCalledWith(CLIENT_USER, "Limpeza", 10);
  });

  it("nao permite antes da tolerancia de 15 minutos", async () => {
    make({ start_time: inHours(-0.1) });
    await expectHttpError(lifecycle.markNoShow(PRO_USER, "ABC123", NOW), 400);
  });

  it("so o profissional registra (cliente recebe 403)", async () => {
    make({ start_time: inHours(-1) });
    await expectHttpError(lifecycle.markNoShow(CLIENT_USER, "ABC123", NOW), 403);
  });

  it("exige agendamento confirmado", async () => {
    make({ status: "pending", start_time: inHours(-1) });
    await expectHttpError(lifecycle.markNoShow(PRO_USER, "ABC123", NOW), 400);
  });
});

describe("reagendamento", () => {
  const newStart = () => inHours(100);

  it("cliente pede e o profissional e notificado", async () => {
    const appt = make();
    await lifecycle.requestReschedule(CLIENT_USER, "ABC123", newStart().toISOString(), NOW);
    expect(appt.reschedule_requested_by).toBe("client");
    expect(appt.reschedule_requested_start).toEqual(newStart());
    expect(appointmentService.assertProfessionalIsFree).toHaveBeenCalledWith(
      20,
      newStart(),
      new Date(newStart().getTime() + 3_600_000),
      undefined,
      10,
    );
    expect(notifications.notifyRescheduleRequested).toHaveBeenCalledWith(
      PRO_USER,
      "Limpeza",
      10,
      newStart(),
    );
  });

  it("recusa pedido com menos de 24h de antecedencia", async () => {
    make({ start_time: inHours(20) });
    await expectHttpError(
      lifecycle.requestReschedule(CLIENT_USER, "ABC123", newStart().toISOString(), NOW),
      400,
    );
  });

  it("recusa horario invalido ou igual ao atual", async () => {
    const appt = make();
    await expectHttpError(lifecycle.requestReschedule(CLIENT_USER, "ABC123", "lixo", NOW), 400);
    await expectHttpError(
      lifecycle.requestReschedule(CLIENT_USER, "ABC123", appt.start_time.toISOString(), NOW),
      400,
    );
  });

  it("se o horario novo estiver ocupado, propaga 409", async () => {
    make();
    mocked(appointmentService.assertProfessionalIsFree).mockRejectedValueOnce(
      HttpError.conflict("ocupado"),
    );
    await expectHttpError(
      lifecycle.requestReschedule(CLIENT_USER, "ABC123", newStart().toISOString(), NOW),
      409,
    );
  });

  it("a outra parte aceita: horario muda e o pedido some", async () => {
    const appt = make({
      reschedule_requested_start: newStart(),
      reschedule_requested_by: "client",
    });
    await lifecycle.respondToReschedule(PRO_USER, "ABC123", true, NOW);
    expect(appt.start_time).toEqual(newStart());
    expect(appt.end_time).toEqual(new Date(newStart().getTime() + 3_600_000));
    expect(appt.reschedule_requested_start).toBeNull();
    expect(notifications.notifyRescheduleAnswered).toHaveBeenCalledWith(CLIENT_USER, "Limpeza", 10, true);
  });

  it("recusar mantem o horario original", async () => {
    const original = inHours(48);
    const appt = make({
      reschedule_requested_start: newStart(),
      reschedule_requested_by: "client",
    });
    await lifecycle.respondToReschedule(PRO_USER, "ABC123", false, NOW);
    expect(appt.start_time).toEqual(original);
    expect(appt.reschedule_requested_by).toBeNull();
  });

  it("quem pediu nao pode responder o proprio pedido", async () => {
    make({ reschedule_requested_start: newStart(), reschedule_requested_by: "client" });
    await expectHttpError(lifecycle.respondToReschedule(CLIENT_USER, "ABC123", true, NOW), 403);
  });

  it("sem pedido pendente ou com accept invalido retorna 400", async () => {
    make();
    await expectHttpError(lifecycle.respondToReschedule(PRO_USER, "ABC123", true, NOW), 400);
    await expectHttpError(lifecycle.respondToReschedule(PRO_USER, "ABC123", "sim", NOW), 400);
  });
});

describe("listRescheduleSlots", () => {
  it("devolve os horarios livres do profissional no dia pedido", async () => {
    make();
    mocked(getAvailableSlots).mockResolvedValue(["09:00", "10:00"]);
    const result = await lifecycle.listRescheduleSlots(CLIENT_USER, "ABC123", "2030-02-01");
    expect(getAvailableSlots).toHaveBeenCalledWith(20, "2030-02-01", 60, 40, expect.anything());
    expect(result).toEqual({ date: "2030-02-01", slots: ["09:00", "10:00"] });
  });

  it("aceita profissional e recusa quem nao participa", async () => {
    make();
    mocked(getAvailableSlots).mockResolvedValue([]);
    await expect(lifecycle.listRescheduleSlots(PRO_USER, "ABC123", "2030-02-01")).resolves.toBeDefined();
    await expectHttpError(lifecycle.listRescheduleSlots(999, "ABC123", "2030-02-01"), 403);
  });

  it("valida a data e o status", async () => {
    make();
    for (const bad of [undefined, "", "01/02/2030", "2030-13-45", "amanha"]) {
      await expectHttpError(lifecycle.listRescheduleSlots(CLIENT_USER, "ABC123", bad), 400);
    }
    make({ status: "completed" });
    await expectHttpError(lifecycle.listRescheduleSlots(CLIENT_USER, "ABC123", "2030-02-01"), 400);
  });
});

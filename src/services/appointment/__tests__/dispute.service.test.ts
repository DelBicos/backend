import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Appointment");
jest.mock("../../../models/Client");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Service");
jest.mock("../../../models/User");
jest.mock("../../../models/Dispute", () => ({
  DISPUTE_REASONS: [
    "service_not_done",
    "poor_quality",
    "wrong_charge",
    "wrong_no_show",
    "professional_absent",
    "other",
  ],
  DISPUTE_RESOLUTIONS: ["refund_full", "refund_partial", "rejected"],
  DisputeModel: { findOne: jest.fn(), create: jest.fn(), findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock("../../payment.service", () => ({
  PaymentService: { getPaidAmountCents: jest.fn(), refundAmount: jest.fn() },
}));
jest.mock("../appointment.service", () => ({ findAppointmentByPublicId: jest.fn() }));
jest.mock("../appointmentNotifications.service", () => ({
  notifyDisputeOpened: jest.fn(),
  notifyDisputeResolved: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AppointmentModel } from "../../../models/Appointment";
import { DisputeModel } from "../../../models/Dispute";
import { PaymentService } from "../../payment.service";
import * as appointmentService from "../appointment.service";
import * as notifications from "../appointmentNotifications.service";
import * as disputes from "../dispute.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const NOW = new Date("2030-01-10T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3_600_000);

const makeAppt = (overrides: Record<string, unknown> = {}) => {
  const appt: any = {
    id: 10,
    status: "completed",
    start_time: daysAgo(2),
    completed_at: daysAgo(2),
    payment_intent_id: "pi_1",
    refunded_cents: null,
    Client: { user_id: 1 },
    Professional: { user_id: 2 },
    Service: { title: "Limpeza" },
    save: jest.fn(),
    ...overrides,
  };
  return appt;
};

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(() => undefined, (e) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const validInput = { reason: "poor_quality", description: "O serviço não foi bem feito." };

beforeEach(() => jest.clearAllMocks());

describe("openDispute", () => {
  it("cliente abre a disputa e o profissional e avisado", async () => {
    mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(makeAppt());
    mocked(DisputeModel.findOne).mockResolvedValue(null);
    mocked(DisputeModel.create).mockResolvedValue({ id: 5 });

    await disputes.openDispute(1, "ABC123", validInput, NOW);

    expect(DisputeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 10, opened_by_user_id: 1, reason: "poor_quality" }),
    );
    expect(notifications.notifyDisputeOpened).toHaveBeenCalledWith(2, "Limpeza", 10);
  });

  it("valida motivo e descricao", async () => {
    await expectHttpError(disputes.openDispute(1, "A", { reason: "x", description: "descricao longa ok" }, NOW), 400);
    await expectHttpError(disputes.openDispute(1, "A", { reason: "other", description: "curta" }, NOW), 400);
  });

  it("so o cliente do agendamento pode abrir", async () => {
    mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(makeAppt());
    await expectHttpError(disputes.openDispute(2, "ABC123", validInput, NOW), 403);
  });

  it("exige pagamento online", async () => {
    mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(makeAppt({ payment_intent_id: null }));
    await expectHttpError(disputes.openDispute(1, "ABC123", validInput, NOW), 400);
  });

  it("respeita o prazo de 7 dias", async () => {
    mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(
      makeAppt({ completed_at: daysAgo(9), start_time: daysAgo(9) }),
    );
    await expectHttpError(disputes.openDispute(1, "ABC123", validInput, NOW), 400);
  });

  it("nao permite duas disputas para o mesmo agendamento", async () => {
    mocked(appointmentService.findAppointmentByPublicId).mockResolvedValue(makeAppt());
    mocked(DisputeModel.findOne).mockResolvedValue({ id: 1 });
    await expectHttpError(disputes.openDispute(1, "ABC123", validInput, NOW), 409);
  });
});

describe("resolveDispute", () => {
  const openDispute = () => {
    const d: any = { id: 5, appointment_id: 10, status: "open", save: jest.fn() };
    mocked(DisputeModel.findByPk).mockResolvedValue(d);
    return d;
  };

  it("reembolso total devolve o que ainda esta retido", async () => {
    const dispute = openDispute();
    const appt = makeAppt({ refunded_cents: 2000 });
    mocked(AppointmentModel.findByPk).mockResolvedValue(appt);
    mocked(PaymentService.getPaidAmountCents).mockResolvedValue(10000);
    mocked(PaymentService.refundAmount).mockResolvedValue(true);

    await disputes.resolveDispute(99, 5, { resolution: "refund_full" });

    expect(PaymentService.refundAmount).toHaveBeenCalledWith("pi_1", 8000);
    expect(appt.refunded_cents).toBe(10000);
    expect(appt.retained_cents).toBe(0);
    expect(dispute).toMatchObject({ status: "resolved", resolution: "refund_full", refund_cents: 8000, resolved_by_user_id: 99 });
    expect(notifications.notifyDisputeResolved).toHaveBeenCalled();
  });

  it("reembolso parcial usa o valor informado", async () => {
    openDispute();
    const appt = makeAppt();
    mocked(AppointmentModel.findByPk).mockResolvedValue(appt);
    mocked(PaymentService.getPaidAmountCents).mockResolvedValue(10000);
    mocked(PaymentService.refundAmount).mockResolvedValue(true);

    await disputes.resolveDispute(99, 5, { resolution: "refund_partial", refundCents: 3000 });

    expect(PaymentService.refundAmount).toHaveBeenCalledWith("pi_1", 3000);
    expect(appt.retained_cents).toBe(7000);
  });

  it("parcial exige valor entre 1 e o maximo (exclusivo)", async () => {
    openDispute();
    mocked(AppointmentModel.findByPk).mockResolvedValue(makeAppt());
    mocked(PaymentService.getPaidAmountCents).mockResolvedValue(10000);
    for (const refundCents of [0, -5, 10000, 20000, 1.5, "abc", undefined]) {
      await expectHttpError(
        disputes.resolveDispute(99, 5, { resolution: "refund_partial", refundCents }),
        400,
      );
    }
    expect(PaymentService.refundAmount).not.toHaveBeenCalled();
  });

  it("recusar exige justificativa e nao mexe no dinheiro", async () => {
    const dispute = openDispute();
    mocked(AppointmentModel.findByPk).mockResolvedValue(makeAppt());
    await expectHttpError(disputes.resolveDispute(99, 5, { resolution: "rejected" }), 400);

    await disputes.resolveDispute(99, 5, { resolution: "rejected", note: "Serviço comprovado no chat." });
    expect(PaymentService.refundAmount).not.toHaveBeenCalled();
    expect(dispute).toMatchObject({ status: "resolved", resolution: "rejected", refund_cents: 0 });
  });

  it("se o estorno falhar, a disputa continua aberta (502)", async () => {
    const dispute = openDispute();
    mocked(AppointmentModel.findByPk).mockResolvedValue(makeAppt());
    mocked(PaymentService.getPaidAmountCents).mockResolvedValue(10000);
    mocked(PaymentService.refundAmount).mockResolvedValue(false);
    await expectHttpError(disputes.resolveDispute(99, 5, { resolution: "refund_full" }), 502);
    expect(dispute.status).toBe("open");
    expect(dispute.save).not.toHaveBeenCalled();
  });

  it("nao resolve duas vezes nem decisao invalida", async () => {
    mocked(DisputeModel.findByPk).mockResolvedValue({ id: 5, status: "resolved" });
    await expectHttpError(disputes.resolveDispute(99, 5, { resolution: "refund_full" }), 409);
    await expectHttpError(disputes.resolveDispute(99, 5, { resolution: "talvez" }), 400);
  });
});

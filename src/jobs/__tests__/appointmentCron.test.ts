jest.mock("../../config/database");
jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../../models/Appointment");
jest.mock("../../models/Notification");
jest.mock("../../models/Professional");
jest.mock("../../models/Client");
jest.mock("../../models/User");
jest.mock("../../models/Service");
jest.mock("../../utils/chatRoom", () => ({ archiveChatRoomForAppointment: jest.fn() }));
jest.mock("../../services/payment.service", () => ({
  PaymentService: { settleUnusedPayment: jest.fn() },
}));
jest.mock("../../services/botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { AppointmentModel } from "../../models/Appointment";
import { NotificationModel } from "../../models/Notification";
import { PaymentService } from "../../services/payment.service";
import { archiveChatRoomForAppointment } from "../../utils/chatRoom";
import { expirePendingAppointments, PENDING_EXPIRY_HOURS } from "../appointmentCron";

const mocked = (fn: unknown) => fn as jest.Mock;

const pending = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: "pending",
  payment_intent_id: `pi_${id}`,
  save: jest.fn().mockResolvedValue(undefined),
  Client: { User: { id: 100 + id } },
  Professional: { User: { id: 200 + id } },
  Service: { title: "Pintura" },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked(PaymentService.settleUnusedPayment).mockResolvedValue("released");
});

describe("expirePendingAppointments", () => {
  it("busca so pedidos pendentes criados ha mais do prazo", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([]);
    const now = new Date("2030-01-10T12:00:00Z");
    expect(await expirePendingAppointments(now)).toBe(0);

    const where = mocked(AppointmentModel.findAll).mock.calls[0][0].where;
    expect(where.status).toBe("pending");
    const [op] = Object.getOwnPropertySymbols(where.createdAt);
    expect(where.createdAt[op]).toEqual(
      new Date(now.getTime() - PENDING_EXPIRY_HOURS * 3_600_000),
    );
  });

  it("cancela como 'system', libera a reserva e avisa cliente e profissional", async () => {
    const appt = pending(1);
    mocked(AppointmentModel.findAll).mockResolvedValue([appt]);

    expect(await expirePendingAppointments()).toBe(1);

    expect(appt).toMatchObject({
      status: "canceled",
      canceled_by: "system",
      retained_cents: 0,
      cancellation_reason: expect.stringContaining("12 horas"),
    });
    expect(appt.save).toHaveBeenCalled();
    expect(PaymentService.settleUnusedPayment).toHaveBeenCalledWith("pi_1");
    expect(archiveChatRoomForAppointment).toHaveBeenCalledWith(1);

    const messages = mocked(NotificationModel.create).mock.calls.map(([n]) => n);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ user_id: 101 });
    expect(messages[0].message).toContain("nenhum valor foi cobrado");
    expect(messages[1]).toMatchObject({ user_id: 201 });
  });

  it("avisa que o estorno esta em andamento quando a devolucao falha", async () => {
    mocked(PaymentService.settleUnusedPayment).mockResolvedValue("failed");
    mocked(AppointmentModel.findAll).mockResolvedValue([pending(2)]);
    await expirePendingAppointments();
    expect(mocked(NotificationModel.create).mock.calls[0][0].message).toContain(
      "estorno está sendo processado",
    );
  });

  it("sem pagamento associado nao chama o Stripe", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([pending(3, { payment_intent_id: null })]);
    await expirePendingAppointments();
    expect(PaymentService.settleUnusedPayment).not.toHaveBeenCalled();
  });

  it("uma falha nao impede os demais agendamentos", async () => {
    const broken = pending(4, { save: jest.fn().mockRejectedValue(new Error("db")) });
    const ok = pending(5);
    mocked(AppointmentModel.findAll).mockResolvedValue([broken, ok]);

    expect(await expirePendingAppointments()).toBe(1);
    expect(ok.status).toBe("canceled");
  });
});

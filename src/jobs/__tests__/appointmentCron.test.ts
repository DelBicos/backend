jest.mock("../../config/database");
jest.mock("../../services/appointmentSchedule.service");
jest.mock("../../services/appointmentRefund.service");
jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../../models/Appointment");
jest.mock("../../models/Notification");
jest.mock("../../models/Professional");
jest.mock("../../models/Client");
jest.mock("../../models/User");
jest.mock("../../models/Service");
jest.mock("../../utils/chatRoom", () => ({ archiveChatRoomForAppointment: jest.fn() }));
jest.mock("../../services/appointment/appointment.service", () => ({
  returnPaymentFor: jest.fn(),
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
import { returnPaymentFor } from "../../services/appointment/appointment.service";
import { processAppointmentRefunds } from "../../services/appointmentRefund.service";
import cron from "node-cron";
import { archiveChatRoomForAppointment } from "../../utils/chatRoom";
import {
  expirePendingAppointments,
  PENDING_EXPIRY_HOURS,
  startAppointmentCron,
} from "../appointmentCron";

const mocked = (fn: unknown) => fn as jest.Mock;

const pending = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: "pending",
  payment_intent_id: `pi_${id}`,
  createdAt: new Date("2020-01-01T00:00:00Z"),
  start_time: new Date("2030-01-20T12:00:00Z"),
  save: jest.fn().mockResolvedValue(undefined),
  Client: { User: { id: 100 + id } },
  Professional: { User: { id: 200 + id } },
  Service: { title: "Pintura" },
  ...extra,
});

/** Sob a trava da agenda o cron relê cada pedido; por padrao, o mesmo objeto. */
function arrange(list: ReturnType<typeof pending>[]) {
  mocked(AppointmentModel.findAll).mockResolvedValue(list);
  mocked(AppointmentModel.findByPk).mockImplementation(
    async (id: number) => list.find((a) => a.id === id) ?? null,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked(returnPaymentFor).mockResolvedValue("released");
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
    arrange([appt]);

    expect(await expirePendingAppointments()).toBe(1);

    expect(appt).toMatchObject({
      status: "canceled",
      canceled_by: "system",
      retained_cents: 0,
      cancellation_reason: expect.stringContaining("12 horas"),
    });
    expect(appt.save).toHaveBeenCalled();
    expect(returnPaymentFor).toHaveBeenCalledWith(appt);
    expect(archiveChatRoomForAppointment).toHaveBeenCalledWith(1);

    const messages = mocked(NotificationModel.create).mock.calls.map(([n]) => n);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ user_id: 101 });
    expect(messages[0].message).toContain("nenhum valor foi cobrado");
    expect(messages[1]).toMatchObject({ user_id: 201 });
  });

  it("avisa que a devolucao esta em andamento quando o Stripe falha (fica na fila)", async () => {
    mocked(returnPaymentFor).mockResolvedValue("processing");
    arrange([pending(2)]);
    await expirePendingAppointments();
    expect(mocked(NotificationModel.create).mock.calls[0][0].message).toContain(
      "devolução do valor está sendo processada",
    );
  });

  it("nao expira pedido aceito enquanto o cron rodava", async () => {
    const appt = pending(3);
    mocked(AppointmentModel.findAll).mockResolvedValue([appt]);
    mocked(AppointmentModel.findByPk).mockResolvedValue({ ...appt, status: "confirmed" });

    expect(await expirePendingAppointments()).toBe(0);
    expect(returnPaymentFor).not.toHaveBeenCalled();
    expect(NotificationModel.create).not.toHaveBeenCalled();
  });

  it("uma falha nao impede os demais agendamentos", async () => {
    const broken = pending(4, { save: jest.fn().mockRejectedValue(new Error("db")) });
    const ok = pending(5);
    arrange([broken, ok]);

    expect(await expirePendingAppointments()).toBe(1);
    expect(ok.status).toBe("canceled");
  });
});

describe("startAppointmentCron", () => {
  it("a cada execucao expira pedidos e processa a fila de devolucao", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([]);
    startAppointmentCron();
    const tick = mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
    await tick();
    expect(processAppointmentRefunds).toHaveBeenCalled();
  });
});

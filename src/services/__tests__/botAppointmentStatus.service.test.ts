jest.mock("../../config/database");
jest.mock("../../models/Appointment");
jest.mock("../../models/BotChatSession");
jest.mock("../../models/Client");
jest.mock("../../models/Professional");
jest.mock("../bot/BotSessionManager", () => ({
  BotSessionManager: { createMessage: jest.fn() },
}));
jest.mock("../../realtime/chatSocket", () => ({
  emitAppointmentStatusUpdate: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { BotState } from "../../constants/botStates";
import { AppointmentModel } from "../../models/Appointment";
import { BotChatSessionModel } from "../../models/BotChatSession";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { emitAppointmentStatusUpdate } from "../../realtime/chatSocket";
import { BotSessionManager } from "../bot/BotSessionManager";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import {
  AppointmentStatus,
  getAppointmentPaymentStatus,
  getAppointmentStatusMessage,
} from "../botAppointmentStatus.helpers";

const appointment = (
  status: AppointmentStatus,
  paymentIntentId: string | null = null,
) => ({
  status,
  payment_intent_id: paymentIntentId,
});

describe("botAppointmentStatus.service", () => {
  it("marca como pagamento pendente quando o profissional aceita antes do pagamento", () => {
    expect(getAppointmentPaymentStatus(appointment("confirmed"))).toBe(
      "pending",
    );
    expect(getAppointmentStatusMessage("confirmed", false)).toContain(
      "pagamento est\u00e1 pendente",
    );
  });

  it("marca como pago quando o PaymentIntent confirmado foi gravado", () => {
    expect(
      getAppointmentPaymentStatus(appointment("confirmed", "pi_test_123")),
    ).toBe("paid");
    expect(getAppointmentStatusMessage("confirmed", true)).toContain(
      "confirmado e pago",
    );
  });

  it.each(["pending", "canceled", "completed"] as const)(
    "n\u00e3o libera pagamento para agendamento %s",
    (status) => {
      expect(getAppointmentPaymentStatus(appointment(status))).toBe(
        "not_available",
      );
    },
  );
});

describe("getAppointmentStatusMessage", () => {
  it.each([
    ["in_transit", "a caminho"],
    ["arrived", "chegou ao local"],
    ["in_progress", "em andamento"],
    ["canceled", "cancelado"],
    ["no_show", "não comparecimento"],
    ["completed", "concluído"],
    ["pending", "pendente de resposta"],
  ] as const)("descreve o status %s", (status, text) => {
    expect(getAppointmentStatusMessage(status, false)).toContain(text);
  });

  it.each(["in_transit", "arrived", "in_progress"] as const)(
    "mantem o pagamento pendente durante a etapa %s",
    (status) => {
      expect(getAppointmentPaymentStatus(appointment(status))).toBe("pending");
    },
  );
});

describe("syncBotSessionsForAppointmentStatus", () => {
  const mocked = (fn: unknown) => fn as jest.Mock;
  const UPDATED = new Date("2030-01-10T12:00:00.000Z");

  const makeAppointment = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 10,
      client_id: 1,
      professional_id: 2,
      status: "confirmed",
      payment_intent_id: null,
      updatedAt: UPDATED,
      ...overrides,
    }) as unknown as AppointmentModel;

  const makeSession = (id: number, context: Record<string, unknown> | null) => ({
    id,
    context,
    status: "ended",
    ended_at: new Date(),
    state: "X",
    save: jest.fn(),
  });

  beforeEach(() => {
    mocked(ClientModel.findByPk).mockResolvedValue({ user_id: 100 });
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ user_id: 200 });
    mocked(BotChatSessionModel.findAll).mockResolvedValue([]);
  });

  it("nao faz nada quando o cliente nao existe", async () => {
    mocked(ClientModel.findByPk).mockResolvedValue(null);

    await expect(syncBotSessionsForAppointmentStatus(makeAppointment())).resolves.toBeNull();
    expect(BotChatSessionModel.findAll).not.toHaveBeenCalled();
    expect(emitAppointmentStatusUpdate).not.toHaveBeenCalled();
  });

  it("atualiza as sessoes, registra a mensagem e avisa cliente e profissional", async () => {
    const changed = makeSession(5, null);
    const same = makeSession(6, { appointmentStatus: "confirmed", appointmentPaid: false, extra: 1 });
    mocked(BotChatSessionModel.findAll).mockResolvedValue([changed, same]);

    const payload = await syncBotSessionsForAppointmentStatus(makeAppointment());

    expect(BotChatSessionModel.findAll).toHaveBeenCalledWith({
      where: { user_id: 100, appointment_id: 10, status: "active" },
      order: [["id", "DESC"]],
    });
    expect(changed).toMatchObject({
      status: "active",
      ended_at: null,
      state: BotState.INICIO,
      context: { appointmentId: 10, appointmentStatus: "confirmed", appointmentPaid: false },
    });
    expect(same.context).toMatchObject({ extra: 1, appointmentId: 10 });
    expect(changed.save).toHaveBeenCalled();
    expect(same.save).toHaveBeenCalled();
    expect(BotSessionManager.createMessage).toHaveBeenCalledTimes(1);
    expect(BotSessionManager.createMessage).toHaveBeenCalledWith(
      5,
      "bot",
      getAppointmentStatusMessage("confirmed", false),
      null,
      { event: "appointment_status", appointment_id: 10, status: "confirmed" },
    );
    expect(payload).toEqual({
      appointment_id: 10,
      status: "confirmed",
      session_ids: [5, 6],
      message: getAppointmentStatusMessage("confirmed", false),
      payment_status: "pending",
      payment_pending: true,
      paid: false,
      updated_at: UPDATED.toISOString(),
    });
    expect(emitAppointmentStatusUpdate).toHaveBeenCalledWith(100, payload);
    expect(emitAppointmentStatusUpdate).toHaveBeenCalledWith(200, payload);
  });

  it("volta a sessao para aguardando confirmacao quando o agendamento esta pendente", async () => {
    const session = makeSession(5, { appointmentStatus: "pending", appointmentPaid: true });
    mocked(BotChatSessionModel.findAll).mockResolvedValue([session]);

    await syncBotSessionsForAppointmentStatus(
      makeAppointment({ status: "pending", payment_intent_id: "pi_1" }),
    );

    expect(session.state).toBe(BotState.AGUARDANDO_CONFIRMACAO);
    expect(BotSessionManager.createMessage).not.toHaveBeenCalled();
  });

  it("registra a mensagem quando so o pagamento mudou e nao avisa profissional inexistente", async () => {
    const session = makeSession(5, { appointmentStatus: "confirmed", appointmentPaid: false });
    mocked(BotChatSessionModel.findAll).mockResolvedValue([session]);
    mocked(ProfessionalModel.findByPk).mockResolvedValue(null);

    const payload = await syncBotSessionsForAppointmentStatus(
      makeAppointment({ payment_intent_id: "pi_1" }),
    );

    expect(BotSessionManager.createMessage).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ paid: true, payment_status: "paid", payment_pending: false });
    expect(emitAppointmentStatusUpdate).toHaveBeenCalledTimes(1);
  });
});

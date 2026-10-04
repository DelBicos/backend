jest.mock("../../../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../../../models/Appointment", () => ({ AppointmentModel: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../../models/Professional", () => ({ ProfessionalModel: { findByPk: jest.fn() } }));
jest.mock("../../../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../../../models/User", () => ({ UserModel: {} }));
jest.mock("../../../../models/Address", () => ({ AddressModel: {} }));
jest.mock("../../../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("../../../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../../../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn() }, logError: jest.fn() }));
jest.mock("../../../availability.service", () => ({ getAvailableSlots: jest.fn() }));
jest.mock("../../../appointmentSchedule.service", () => ({
  withProfessionalScheduleLock: jest.fn(async (_id: number, work: (transaction: unknown) => Promise<unknown>) => work({ LOCK: { UPDATE: "UPDATE" } })),
}));
import { ClientModel } from "../../../../models/Client";
import { AppointmentModel } from "../../../../models/Appointment";
import { ProfessionalModel } from "../../../../models/Professional";
import { NotificationModel } from "../../../../models/Notification";
import type { BotChatSessionModel } from "../../../../models/BotChatSession";
import { InicioState } from "../InicioState.service";
import { AguardandoIdAgendamentoState } from "../AguardandoIdAgendamentoState.service";
import { ConfirmacaoState } from "../ConfirmacaoState.service";
import { cancelBotAppointment } from "../appointmentActions.service";

const save = jest.fn();
const appointment = {
  id: 92, short_id: "A7F3", client_id: 6, professional_id: 1, service_id: 2,
  status: "pending", start_time: new Date("2030-11-09T20:00:00Z"),
  end_time: new Date("2030-11-09T21:00:00Z"), save,
};
beforeEach(() => {
  jest.resetAllMocks();
  appointment.status = "pending";
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 6 });
  (AppointmentModel.findOne as jest.Mock).mockResolvedValue(appointment);
  (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment);
  (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 10 });
  // Restore the transaction callback after resetAllMocks.
  const { withProfessionalScheduleLock } = jest.requireMock("../../../appointmentSchedule.service") as {
    withProfessionalScheduleLock: jest.Mock;
  };
  withProfessionalScheduleLock.mockImplementation(async (_id: number, work: (transaction: unknown) => Promise<unknown>) => work({ LOCK: { UPDATE: "UPDATE" } }));
});

it.each(["A7F3", "a7f3", "1AB234"])("vai direto à confirmação de cancelar #%s sem alterar o banco", async (code) => {
  const result = await new InicioState().handle(`cancelar #${code}`,
    { intent: "CANCELAR", entities: {}, confidence: 1 }, { context: {} } as BotChatSessionModel, 6);
  expect(result.nextState).toBe("CONFIRMACAO");
  expect(result.contextUpdate).toMatchObject({ appointmentId: 92, pendingAction: "CANCEL" });
  expect(AppointmentModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { short_id: code.toUpperCase() } }));
  expect(save).not.toHaveBeenCalled();
  expect(NotificationModel.create).not.toHaveBeenCalled();
});

it("aceita #ID ao responder à seleção", async () => {
  const result = await new AguardandoIdAgendamentoState().handle("#A7F3",
    { intent: "FALLBACK", entities: {}, confidence: 1 },
    { context: { pendingAction: "CANCEL" } } as BotChatSessionModel, 6);
  expect(result.nextState).toBe("CONFIRMACAO");
});

it("não revela nem cancela agendamento de outro cliente", async () => {
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 99 });
  const result = await new InicioState().handle("cancelar #A7F3",
    { intent: "CANCELAR", entities: {}, confidence: 1 }, { context: {} } as BotChatSessionModel, 99);
  expect(result.reply).toContain("Agendamento não encontrado");
  expect(save).not.toHaveBeenCalled();
});

it.each(["não", "talvez"])("não cancela com resposta %s", async (answer) => {
  await new ConfirmacaoState().handle(answer, { intent: "FALLBACK", entities: {}, confidence: 1 },
    { context: { appointmentId: 92, pendingAction: "CANCEL" } } as BotChatSessionModel, 6);
  expect(save).not.toHaveBeenCalled();
  expect(NotificationModel.create).not.toHaveBeenCalled();
});

it("confirma e notifica o usuário do profissional na mesma transação", async () => {
  const result = await new ConfirmacaoState().handle("sim", { intent: "FALLBACK", entities: {}, confidence: 1 },
    { context: { appointmentId: 92, pendingAction: "CANCEL" } } as BotChatSessionModel, 6);
  expect(result.reply).toContain("cancelado com sucesso");
  expect(appointment.status).toBe("canceled");
  expect(NotificationModel.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 10, related_entity_id: 92, notification_type: "appointment" }), save.mock.calls[0][0]);
  await expect(cancelBotAppointment(6, 92)).rejects.toThrow("já está cancelado");
  expect(NotificationModel.create).toHaveBeenCalledTimes(1);
});

it("falha sem salvar o cancelamento quando não consegue criar a notificação", async () => {
  (NotificationModel.create as jest.Mock).mockRejectedValue(new Error("notification unavailable"));
  await expect(cancelBotAppointment(6, 92)).rejects.toThrow("notification unavailable");
  expect(save).not.toHaveBeenCalled();
  expect(appointment.status).toBe("pending");
});

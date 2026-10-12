jest.mock("../../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../../models/Appointment", () => ({ AppointmentModel: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../models/Service", () => ({ ServiceModel: { findAll: jest.fn(), findByPk: jest.fn() } }));
jest.mock("../../../models/Professional", () => ({ ProfessionalModel: { findByPk: jest.fn() } }));
jest.mock("../../../models/User", () => ({ UserModel: {} }));
jest.mock("../../../models/Address", () => ({ AddressModel: {} }));
jest.mock("../../../models/Notification", () => ({ NotificationModel: { bulkCreate: jest.fn() } }));
jest.mock("../../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn() }, logError: jest.fn() }));
jest.mock("../../availability.service", () => ({ getAvailableSlots: jest.fn() }));
jest.mock("../../appointmentSchedule.service", () => ({ withProfessionalScheduleLock: jest.fn() }));
jest.mock("../states/cancellationCode.service", () => ({ handleCancellationCode: jest.fn() }));
jest.mock("../states/ColetandoServicoState", () => ({ ColetandoServicoState: class {} }));
jest.mock("../states/SelecionandoProfissionalState", () => ({ SelecionandoProfissionalState: class {} }));
jest.mock("../states/AguardandoConfirmacaoState", () => ({ AguardandoConfirmacaoState: class {} }));
jest.mock("../BotSessionManager", () => ({
  BotSessionManager: { getOrCreateSession: jest.fn(), createMessage: jest.fn(), saveSession: jest.fn() },
}));

import { BotState } from "../../../constants/botStates";
import type { BotChatSessionModel } from "../../../models/BotChatSession";
import { ClientModel } from "../../../models/Client";
import { AppointmentModel } from "../../../models/Appointment";
import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { NotificationModel } from "../../../models/Notification";
import { getAvailableSlots } from "../../availability.service";
import { withProfessionalScheduleLock } from "../../appointmentSchedule.service";
import { analyzeMessage } from "../../nlu.service";
import { BotMessageRouter } from "../BotMessageRouter.service";
import { BotSessionManager } from "../BotSessionManager";
import { processMessage } from "../botConversation.service";

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const save = jest.fn();
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
let session: BotChatSessionModel;
let appointment: AppointmentModel;

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2030-01-01T12:00:00Z"));
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: jest.fn().mockRejectedValue(new Error("offline")) });
  session = { state: BotState.INICIO, context: {} } as BotChatSessionModel;
  jest.mocked(BotSessionManager.getOrCreateSession).mockResolvedValue(session);
  jest.mocked(BotSessionManager.saveSession).mockImplementation(async (current, state, context, appointmentId) => {
    current.state = state;
    current.context = context;
    if (appointmentId !== undefined) current.appointment_id = appointmentId;
  });
  appointment = {
    id: 92, short_id: "A7F3", client_id: 6, professional_id: 10, service_id: 20,
    status: "confirmed", start_time: new Date("2030-01-05T12:00:00Z"),
    end_time: new Date("2030-01-05T13:00:00Z"), final_price: 75,
    payment_intent_id: "pi_paid", address_id: 30, save,
    Service: { title: "Limpeza", duration: 90, price_cents: 15000 },
    Professional: { User: { name: "Ana" } },
  } as unknown as AppointmentModel;
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 6 });
  (AppointmentModel.findOne as jest.Mock).mockResolvedValue(appointment);
  (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment);
  (AppointmentModel.findAll as jest.Mock).mockResolvedValue([appointment]);
  const service = { id: 20, professional_id: 10, active: true, duration: 90, price_cents: 15000, Professional: { User: { name: "Ana" } } };
  (ServiceModel.findAll as jest.Mock).mockResolvedValue([service]);
  (ServiceModel.findByPk as jest.Mock).mockResolvedValue(service);
  (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 10, user_id: 11 });
  (getAvailableSlots as jest.Mock).mockResolvedValue(["15:00", "16:00"]);
  (withProfessionalScheduleLock as jest.Mock).mockImplementation(async (_id: number, work: (tx: unknown) => Promise<unknown>) => work(transaction));
});

afterEach(() => {
  jest.useRealTimers();
  if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
  else Reflect.deleteProperty(globalThis, "fetch");
});

async function message(text: string) {
  const nlu = await analyzeMessage(text, { ...session.context });
  const result = await BotMessageRouter.route(session.state as BotState, text, nlu, session, 7);
  session.context = { ...session.context, ...result.contextUpdate };
  session.state = result.nextState;
  return result;
}

it("reconhece o comando do Jira e mantém a antecedência mínima acordada", async () => {
  const result = await message("alterar #A7F3 para amanhã 15h");
  expect(session.context).toMatchObject({ pendingAction: "RESCHEDULE", appointmentId: 92 });
  expect(result.nextState).toBe(BotState.COLETANDO_DATA);
  expect(result.reply).toContain("antecedência");
  expect(save).not.toHaveBeenCalled();
});

it("valida o comando completo, confirma e atualiza a reserva com avisos atômicos", async () => {
  const result = await message("alterar #A7F3 para 07/01/2030 15h");
  expect(result.nextState).toBe(BotState.CONFIRMACAO);
  expect(session.context).toMatchObject({ appointmentId: 92, professionalId: 10, newDate: "2030-01-07", newTime: "15:00", serviceDuration: 60, servicePrice: 7500 });
  expect(getAvailableSlots).toHaveBeenCalledWith(10, "2030-01-07", 60, 20, { excludeAppointmentId: 92 });
  expect(save).not.toHaveBeenCalled();
  expect(NotificationModel.bulkCreate).not.toHaveBeenCalled();
  const confirmed = await message("sim");
  expect(confirmed.nextState).toBe(BotState.AGUARDANDO_CONFIRMACAO);
  expect(appointment).toMatchObject({ id: 92, status: "pending", payment_intent_id: "pi_paid", final_price: 75, address_id: 30, start_time: new Date("2030-01-07T18:00:00Z"), end_time: new Date("2030-01-07T19:00:00Z") });
  expect(save).toHaveBeenCalledWith({ transaction });
  expect(NotificationModel.bulkCreate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ user_id: 11, related_entity_id: 92 })]), { transaction });
});

it("oferece alternativas quando o horário solicitado está ocupado", async () => {
  (getAvailableSlots as jest.Mock).mockResolvedValue(["16:00"]);
  const result = await message("alterar #A7F3 para 07/01/2030 15h");
  expect(result.nextState).toBe(BotState.COLETANDO_HORARIO);
  expect(result.reply).toContain("16:00");
  expect(save).not.toHaveBeenCalled();
  expect((await message("16h")).nextState).toBe(BotState.CONFIRMACAO);
});

it.each(["não", "sim?", "ok, mas quanto custa?", "pode me explicar?", "confirmar cancelamento"])("não remarca com resposta ambígua ou negativa: %s", async (answer) => {
  await message("alterar #A7F3 para 07/01/2030 15h");
  await message(answer);
  expect(save).not.toHaveBeenCalled();
  expect(NotificationModel.bulkCreate).not.toHaveBeenCalled();
});

it("revalida disponibilidade depois da confirmação", async () => {
  await message("alterar #A7F3 para 07/01/2030 15h");
  (getAvailableSlots as jest.Mock).mockResolvedValue([]);
  const result = await message("sim");
  expect(result.nextState).toBe(BotState.COLETANDO_HORARIO);
  expect(result.reply).toContain("não está mais disponível");
  expect(save).not.toHaveBeenCalled();
  expect(NotificationModel.bulkCreate).not.toHaveBeenCalled();
});

it("propaga falha na notificação para a transação sem informar sucesso", async () => {
  await message("alterar #A7F3 para 07/01/2030 15h");
  (NotificationModel.bulkCreate as jest.Mock).mockRejectedValue(new Error("Falha na notificação"));
  const result = await message("sim");
  expect(result.reply).toContain("Falha na notificação");
  expect(result.nextState).toBe(BotState.COLETANDO_HORARIO);
  expect(save).toHaveBeenCalledWith({ transaction });
  expect(NotificationModel.bulkCreate).toHaveBeenCalledWith(expect.any(Array), { transaction });
});

it("não revela nem altera uma reserva de outro cliente", async () => {
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 999 });
  const result = await message("alterar #A7F3 para 07/01/2030 15h");
  expect(result.reply).toContain("Agendamento não encontrado");
  expect(result.reply).not.toContain("Ana");
  expect(getAvailableSlots).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("não confunde números de data ou horário com o ID ausente", async () => {
  const result = await message("alterar para 07/01/2030 15h");
  expect(result.nextState).toBe(BotState.AGUARDANDO_ID_AGENDAMENTO);
  expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
  expect(AppointmentModel.findOne).not.toHaveBeenCalled();
});

it.each(["alterar 92", "alterar agendamento 92", "alterar #a7f3"])("aceita referência explícita sem exigir repetição: %s", async (command) => {
  expect((await message(`${command} para 07/01/2030 15h`)).nextState).toBe(BotState.CONFIRMACAO);
  expect(session.context?.appointmentId).toBe(92);
});

it.each(["completed", "canceled"])("recusa remarcação de agendamento %s", async (status) => {
  Object.assign(appointment, { status });
  expect((await message("alterar #A7F3 para 07/01/2030 15h")).nextState).toBe(BotState.INICIO);
  expect(getAvailableSlots).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("processa a conversa completa e o ISO enviado pelo frontend, persistindo a sessão", async () => {
  const result = await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030 15h");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ appointmentId: 92, newDate: "2030-01-07", newTime: "15:00" });
  expect(save).not.toHaveBeenCalled();
  const confirmed = await processMessage(7, "auth", "sim", undefined, "web", "2030-01-07T18:00:00Z");
  expect(confirmed.state).toBe(BotState.AGUARDANDO_CONFIRMACAO);
  expect(session.appointment_id).toBe(92);
  expect(save).toHaveBeenCalledTimes(1);
  expect(NotificationModel.bulkCreate).toHaveBeenCalledTimes(1);
});

it("rejeita ISO antigo enviado na confirmação sem alterar a reserva", async () => {
  await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030 15h");
  const result = await processMessage(7, "auth", "sim", undefined, "web", "2030-01-05T12:00:00Z");
  expect(result.message).toContain("não corresponde");
  expect(save).not.toHaveBeenCalled();
});

it("inicia nova remarcação a partir de uma conversa que acompanhava outra reserva", async () => {
  session.state = BotState.AGUARDANDO_CONFIRMACAO;
  session.appointment_id = 500;
  session.context = { pendingAction: "CREATE", appointmentId: 500, serviceId: 999 };
  const result = await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030 15h");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ pendingAction: "RESCHEDULE", appointmentId: 92, serviceId: 20 });
  expect(save).not.toHaveBeenCalled();
});

it.each(["quero manter", "manter o horário", "mesmo horário"])("mantém o horário original após escolher outra data: %s", async (answer) => {
  (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00", "15:00"]);
  await processMessage(7, "auth", "alterar #A7F3");
  await processMessage(7, "auth", "07/01/2030");
  const result = await processMessage(7, "auth", answer);
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ newDate: "2030-01-07", newTime: "09:00" });
  expect(save).not.toHaveBeenCalled();
  await processMessage(7, "auth", "sim");
  expect(appointment.start_time).toEqual(new Date("2030-01-07T12:00:00Z"));
});

it.each(["quero manter", "manter a data", "mesmo dia", "quero alterar só o horário"])("mantém a data e permite escolher outro horário: %s", async (answer) => {
  await processMessage(7, "auth", "alterar #A7F3");
  const day = await processMessage(7, "auth", answer);
  expect(day.state).toBe(BotState.COLETANDO_HORARIO);
  expect(day.context.newDate).toBe("2030-01-05");
  const result = await processMessage(7, "auth", "15h");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ newDate: "2030-01-05", newTime: "15:00" });
  expect(save).not.toHaveBeenCalled();
});

it("altera dia e horário em mensagens separadas", async () => {
  await processMessage(7, "auth", "alterar #A7F3");
  await processMessage(7, "auth", "07/01/2030");
  const result = await processMessage(7, "auth", "16h");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ newDate: "2030-01-07", newTime: "16:00" });
});

it("não mantém um horário indisponível no novo dia", async () => {
  await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030");
  const result = await processMessage(7, "auth", "quero manter");
  expect(result.state).toBe(BotState.COLETANDO_HORARIO);
  expect(result.message).toContain("09:00");
  expect(result.message).toContain("15:00");
  expect(save).not.toHaveBeenCalled();
});

it("entende data e preservação do horário em um único comando", async () => {
  (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00"]);
  const result = await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030 mantendo o horário");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ newDate: "2030-01-07", newTime: "09:00" });
});

it("não trata recusa de manter como autorização para reutilizar o horário", async () => {
  await processMessage(7, "auth", "alterar #A7F3 para 07/01/2030");
  const result = await processMessage(7, "auth", "não quero manter");
  expect(result.state).toBe(BotState.COLETANDO_HORARIO);
  expect(result.context.newTime).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
});

it("lembra a preferência de manter o horário enquanto espera a nova data", async () => {
  (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00"]);
  await processMessage(7, "auth", "alterar #A7F3, quero alterar só a data");
  const result = await processMessage(7, "auth", "07/01/2030");
  expect(result.state).toBe(BotState.CONFIRMACAO);
  expect(result.context).toMatchObject({ newDate: "2030-01-07", newTime: "09:00" });
});

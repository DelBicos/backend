jest.mock("../../../models/Address", () => ({ AddressModel: { findAll: jest.fn(), findOne: jest.fn() } }));
jest.mock("../../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../../models/Service", () => ({ ServiceModel: { findByPk: jest.fn() } }));
jest.mock("../../../models/Professional", () => ({ ProfessionalModel: { findByPk: jest.fn() } }));
jest.mock("../../../models/Appointment", () => ({ AppointmentModel: { create: jest.fn() } }));
jest.mock("../../../models/User", () => ({ UserModel: { findByPk: jest.fn() } }));
jest.mock("../../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("../../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../../../utils/logger", () => ({
  __esModule: true, default: { info: jest.fn(), warn: jest.fn() }, logError: jest.fn(),
}));
jest.mock("../../availability.service", () => ({ getAvailableSlots: jest.fn() }));
jest.mock("../../appointmentSchedule.service", () => ({
  withProfessionalScheduleLock: jest.fn(async (_id: number, action: (transaction: unknown) => Promise<unknown>) =>
    action({ LOCK: { UPDATE: "UPDATE" } })),
}));
jest.mock("../../nlu.service", () => ({ analyzeMessage: jest.fn(), isRestartCommand: jest.fn(() => false) }));
jest.mock("../BotSessionManager", () => ({
  BotSessionManager: { getOrCreateSession: jest.fn(), createMessage: jest.fn(), saveSession: jest.fn() },
}));
// Earlier scheduling stages have their own availability/semantic tests. Keep
// the actual professional selection, details, final confirmation and creation.
jest.mock("../states/InicioState", () => ({ InicioState: class {} }));
jest.mock("../states/ColetandoServicoState", () => ({ ColetandoServicoState: class {} }));
jest.mock("../states/ColetandoDataState", () => ({ ColetandoDataState: class {} }));
jest.mock("../states/ColetandoHorarioState", () => ({ ColetandoHorarioState: class {} }));
jest.mock("../states/AguardandoIdAgendamentoState", () => ({ AguardandoIdAgendamentoState: class {} }));
jest.mock("../states/AguardandoConfirmacaoState", () => ({ AguardandoConfirmacaoState: class {} }));
jest.mock("../../voiceTranscription.service", () => ({
  ALLOWED_AUDIO_MIME_TYPES: new Set(["audio/webm"]), transcribeVoiceAudio: jest.fn(),
  VoiceTranscriptionConfigurationError: class extends Error {},
  VoiceTranscriptionProviderError: class extends Error {},
  VoiceTranscriptionRateLimitError: class extends Error {},
  VoiceUnclearAudioError: class extends Error {},
}));

import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../interfaces/authentication.interface";
import type { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { AddressModel } from "../../../models/Address";
import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { AppointmentModel } from "../../../models/Appointment";
import { UserModel } from "../../../models/User";
import { getAvailableSlots } from "../../availability.service";
import { analyzeMessage, NluResult } from "../../nlu.service";
import { BotSessionManager } from "../BotSessionManager";
import { processMessage } from "../botConversation.service";
import { processVoiceCommand } from "../../../controllers/voice.controller";
import { transcribeVoiceAudio } from "../../voiceTranscription.service";
import { createBotAppointment } from "../states/appointmentActions.service";

let session: BotChatSessionModel;
const date = "2099-01-05";
const address = {
  id: 42, user_id: 7, active: true, street: "Rua das Flores", number: "20",
  neighborhood: "Centro", city: "São Paulo", state: "SP", postal_code: "01001000",
} as AddressModel;
const service = { id: 2, professional_id: 3, active: true, duration: 60, title: "Limpeza" } as ServiceModel;
const nlu: NluResult = { intent: "FALLBACK", entities: {}, confidence: 1 };

beforeEach(() => {
  jest.resetAllMocks();
  // resetAllMocks also clears the implementation of the transaction stub.
  const schedule = jest.requireMock("../../appointmentSchedule.service") as {
    withProfessionalScheduleLock: jest.Mock;
  };
  schedule.withProfessionalScheduleLock.mockImplementation(
    async (_id: number, action: (transaction: unknown) => Promise<unknown>) => action({ LOCK: { UPDATE: "UPDATE" } }),
  );
  session = {
    id: 50, user_id: 7, state: "SELECIONANDO_PROFISSIONAL", status: "active", channel: "web",
    context: {
      pendingAction: "CREATE", serviceName: "Limpeza", date, time: "09:00",
      professionalOptionsData: [{ index: 1, serviceId: 2, professionalId: 3,
        professionalName: "Ana", price: 12000, duration: 60, time: "09:00" }],
    },
  } as BotChatSessionModel;
  jest.mocked(BotSessionManager.getOrCreateSession).mockResolvedValue(session);
  jest.mocked(BotSessionManager.saveSession).mockImplementation(async (current, state, context) => {
    current.state = state;
    current.context = context;
  });
  jest.mocked(analyzeMessage).mockResolvedValue(nlu);
  jest.mocked(AddressModel.findAll).mockResolvedValue([address]);
  jest.mocked(AddressModel.findOne).mockResolvedValue(address);
  jest.mocked(ClientModel.findOne).mockResolvedValue({ id: 8, user_id: 7, main_address_id: 99 } as ClientModel);
  jest.mocked(ServiceModel.findByPk).mockResolvedValue(service);
  jest.mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 3, user_id: 9 } as ProfessionalModel);
  jest.mocked(UserModel.findByPk).mockResolvedValue(null);
  jest.mocked(getAvailableSlots).mockResolvedValue(["09:00"]);
  jest.mocked(AppointmentModel.create).mockResolvedValue({ id: 80, status: "pending" } as AppointmentModel);
});

async function textMessage(message: string) {
  return processMessage(7, "auth-session", message, 50, "web");
}

async function voiceMessage(message: string, intent?: NluResult["intent"]) {
  if (intent) jest.mocked(analyzeMessage).mockResolvedValue({ ...nlu, intent });
  jest.mocked(transcribeVoiceAudio).mockResolvedValue(message);
  const audio = Buffer.from("mock audio");
  const request = {
    user: { id: 7 }, authSessionId: "auth-session", body: audio,
    header: (name: string) => ({ "content-type": "audio/webm", "x-voice-session-id": "50" })[name],
  } as unknown as AuthenticatedRequest;
  const json = jest.fn();
  const response = { json, setHeader: jest.fn(), status: jest.fn() } as unknown as Response;
  await processVoiceCommand(request, response);
  expect(audio.equals(Buffer.alloc(audio.length))).toBe(true);
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ session_id: 50, transcript: message }));
}

it.each(["text", "voice", "mixed"])("revisa endereço e cria só após confirmação final (%s)", async (channel) => {
  const send = channel === "voice" ? voiceMessage : textMessage;
  await send("Ana");
  expect(session.state).toBe("COLETANDO_ENDERECO");
  expect(session.context?.addressOptions).toEqual([{ id: 42, label: expect.stringContaining("Rua das Flores") }]);
  expect(AddressModel.findAll).toHaveBeenCalledWith({ where: { user_id: 7, active: true }, order: [["id", "ASC"]] });
  expect(AppointmentModel.create).not.toHaveBeenCalled();

  await (channel === "mixed" ? voiceMessage : send)("primeiro");
  expect(session.state).toBe("CONFIRMACAO");
  expect(session.context?.addressId).toBe(42);
  expect(session.context?.bookingDetailsStep).toBe("REVIEW");
  expect(session.context?.addressLabel).toContain("Rua das Flores");
  expect(BotSessionManager.createMessage).toHaveBeenLastCalledWith(50, "bot", expect.stringContaining("Status: ficará pendente"));
  expect(AppointmentModel.create).not.toHaveBeenCalled();

  await send("sim");
  expect(session.state).toBe("AGUARDANDO_CONFIRMACAO");
  expect(AppointmentModel.create).toHaveBeenCalledTimes(1);
  expect(AppointmentModel.create).toHaveBeenCalledWith(expect.objectContaining({
    client_id: 8, address_id: 42, service_id: 2, professional_id: 3, status: "pending",
  }), expect.objectContaining({ transaction: expect.any(Object) }));
  expect(AddressModel.findOne).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: 42, user_id: 7, active: true }, lock: "UPDATE", transaction: expect.any(Object),
  }));
  expect(session.context?.appointmentPaid).toBe(false);
});

it.each(["AGENDAR", "ALTERAR", "CONSULTAR", "SAUDACAO"] as const)("mantém a resposta falada na etapa atual quando o NLU infere %s", async (intent) => {
  await textMessage("Ana");
  jest.mocked(analyzeMessage).mockResolvedValue({ ...nlu, intent });
  await voiceMessage("primeira opção");
  expect(session.state).toBe("CONFIRMACAO");
  jest.mocked(analyzeMessage).mockResolvedValue({ ...nlu, intent });
  await voiceMessage("sim");
  expect(session.state).toBe("AGUARDANDO_CONFIRMACAO");
  expect(session.context?.serviceId).toBe(2);
  expect(AppointmentModel.create).toHaveBeenCalledTimes(1);
});

it("não escolhe endereço inexistente e segue para revisão sem perguntar pagamento", async () => {
  await textMessage("Ana");
  await textMessage("99");
  expect(session.state).toBe("COLETANDO_ENDERECO");
  expect(session.context?.addressId).toBeUndefined();
  await textMessage("1");
  expect(session.state).toBe("CONFIRMACAO");
  expect(session.context?.bookingDetailsStep).toBe("REVIEW");
  expect(BotSessionManager.createMessage).toHaveBeenLastCalledWith(50, "bot", expect.stringContaining("Status: ficará pendente"));
  expect(AppointmentModel.create).not.toHaveBeenCalled();
});

it("orienta cadastro e retoma os dados sem usar endereço padrão", async () => {
  jest.mocked(AddressModel.findAll).mockResolvedValue([]);
  const response = await textMessage("Ana");
  expect(response.message).toContain("Cadastre o endereço");
  expect(session.context).toMatchObject({ serviceId: 2, date, time: "09:00" });
  jest.mocked(AddressModel.findAll).mockResolvedValue([address]);
  await voiceMessage("continuar");
  expect(session.context?.addressOptions).toHaveLength(1);
  expect(AppointmentModel.create).not.toHaveBeenCalled();
});

it("reconsulta a lista se o endereço foi removido antes da seleção", async () => {
  await textMessage("Ana");
  jest.mocked(AddressModel.findOne).mockResolvedValue(null);
  jest.mocked(AddressModel.findAll).mockResolvedValue([]);
  await textMessage("1");
  expect(session.state).toBe("COLETANDO_ENDERECO");
  expect(session.context?.addressId).toBeUndefined();
});

it("não cria se o endereço foi desativado ou perdeu titularidade antes da confirmação", async () => {
  await textMessage("Ana");
  await textMessage("1");
  jest.mocked(AddressModel.findOne).mockResolvedValue(null);
  await textMessage("sim");
  expect(session.state).toBe("COLETANDO_ENDERECO");
  expect(AppointmentModel.create).not.toHaveBeenCalled();
});

it("permite trocar endereço na revisão sem o NLU reiniciar o agendamento", async () => {
  await textMessage("Ana");
  await textMessage("1");
  jest.mocked(analyzeMessage).mockResolvedValue({ ...nlu, intent: "ALTERAR" });
  await voiceMessage("trocar endereço", "FALLBACK");
  expect(session.state).toBe("COLETANDO_ENDERECO");
  expect(session.context?.addressId).toBeUndefined();
  expect(session.context?.date).toBe(date);
});

it("revalida disponibilidade e pede outro horário se o slot foi ocupado durante a coleta", async () => {
  await textMessage("Ana");
  await textMessage("1");
  jest.mocked(getAvailableSlots).mockResolvedValue([]);
  const response = await textMessage("sim");
  expect(response.state).toBe("COLETANDO_HORARIO");
  expect(response.message).toContain("não está mais disponível");
  expect(session.context?.bookingDetailsStep).toBeUndefined();
  expect(AppointmentModel.create).not.toHaveBeenCalled();
});

it("protege a criação direta sem endereço mesmo com endereço principal no cadastro", async () => {
  const context: BotSessionContext = { serviceId: 2, professionalId: 3, date, time: "09:00" };
  await expect(createBotAppointment(7, context)).rejects.toThrow("Escolha o endereço");
  expect(AppointmentModel.create).not.toHaveBeenCalled();
});

it("recusar na revisão final não cria a reserva", async () => {
  await textMessage("Ana");
  await textMessage("1");
  await textMessage("não");
  expect(AppointmentModel.create).not.toHaveBeenCalled();
  expect(session.context?.addressId).toBeUndefined();
});

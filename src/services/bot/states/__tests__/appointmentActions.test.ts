jest.mock("../../../../config/database");
jest.mock("../../../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../../../models/Professional", () => ({ ProfessionalModel: { findByPk: jest.fn() } }));
jest.mock("../../../../models/Service", () => ({ ServiceModel: { findByPk: jest.fn() } }));
jest.mock("../../../../models/Address", () => ({ AddressModel: { findOne: jest.fn() } }));
jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: { findByPk: jest.fn(), create: jest.fn() },
}));
jest.mock("../../../../models/User", () => ({ UserModel: { findByPk: jest.fn() } }));
jest.mock("../../../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("../../../availability.service", () => ({ getAvailableSlots: jest.fn() }));
jest.mock("../../../appointmentSchedule.service", () => ({
  withProfessionalScheduleLock: jest.fn(),
}));
jest.mock("../../../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../../../appointment/lifecycle.rules", () => ({
  cancelAppointment: jest.fn(),
  requestReschedule: jest.fn(),
}));
jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import type { BotSessionContext } from "../../../../models/BotChatSession";
import { ClientModel } from "../../../../models/Client";
import { ProfessionalModel } from "../../../../models/Professional";
import { ServiceModel } from "../../../../models/Service";
import { AddressModel } from "../../../../models/Address";
import { AppointmentModel } from "../../../../models/Appointment";
import { UserModel } from "../../../../models/User";
import { NotificationModel } from "../../../../models/Notification";
import { getAvailableSlots } from "../../../availability.service";
import { withProfessionalScheduleLock } from "../../../appointmentSchedule.service";
import { ensureChatRoomForAppointment } from "../../../../utils/chatRoom";
import { cancelAppointment, requestReschedule } from "../../../appointment/lifecycle.rules";
import logger from "../../../../utils/logger";
import {
  cancelBotAppointment,
  createBotAppointment,
  rescheduleBotAppointment,
  resolveBotAppointmentStart,
} from "../appointmentActions";

const mocked = (fn: unknown) => fn as jest.Mock;
const transaction = { LOCK: { UPDATE: "UPDATE" } };

// 2030-01-07 10:00 em São Paulo (UTC-3).
const DATE = "2030-01-07";
const TIME = "10:00";
const START_ISO = "2030-01-07T13:00:00.000Z";

beforeEach(() => {
  jest.clearAllMocks();
  mocked(withProfessionalScheduleLock).mockImplementation(
    (_id: number, work: (tx: typeof transaction) => unknown) => work(transaction),
  );
});

describe("resolveBotAppointmentStart", () => {
  it("converte data e hora locais para o instante em UTC", () => {
    expect(resolveBotAppointmentStart(DATE, TIME).toISOString()).toBe(START_ISO);
  });

  it.each([
    ["data inválida", "2030-13-40", TIME],
    ["data no passado", "2000-01-01", TIME],
    ["hora fora do formato", DATE, "9:00"],
    ["hora inexistente", DATE, "24:00"],
  ])("recusa %s", (_caso, date, time) => {
    expect(() => resolveBotAppointmentStart(date, time)).toThrow(
      "Escolha um horário com pelo menos 12 horas de antecedência.",
    );
  });

  it.each([
    ["com Z", "2030-01-07T13:00:00Z"],
    ["com offset", "2030-01-07T10:00:00-03:00"],
    ["com milissegundos", "2030-01-07T13:00:00.000Z"],
  ])("aceita o horário escolhido %s quando é o mesmo instante", (_caso, iso) => {
    expect(resolveBotAppointmentStart(DATE, TIME, iso).toISOString()).toBe(START_ISO);
  });

  it.each([
    ["sem offset", "2030-01-07T10:00:00"],
    ["de outro instante", "2030-01-07T14:00:00Z"],
    ["com dia impossível", "2030-02-31T13:00:00Z"],
  ])("recusa o horário escolhido %s", (_caso, iso) => {
    expect(() => resolveBotAppointmentStart(DATE, TIME, iso)).toThrow(
      "O horário enviado não corresponde ao horário confirmado. Escolha novamente.",
    );
  });
});

describe("createBotAppointment", () => {
  const ctx: BotSessionContext = { serviceId: 3, professionalId: 4, date: DATE, time: " 10:00 " };
  const client = { id: 20, user_id: 1, main_address_id: 30 };
  const professional = { id: 4, user_id: 40 };
  const service = { id: 3, title: "Pintura", active: true, professional_id: 4, duration: 60 };
  const appointment = { id: 99 };

  const happyPath = () => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professional);
    mocked(ServiceModel.findByPk).mockResolvedValue(service);
    mocked(getAvailableSlots).mockResolvedValue(["09:00", "10:00"]);
    mocked(AppointmentModel.create).mockResolvedValue(appointment);
    mocked(UserModel.findByPk).mockImplementation(async (id: number) =>
      id === 1 ? { id: 1, name: "Ana" } : { id: 40, name: "Prof" },
    );
  };

  it.each([
    ["serviço", { ...ctx, serviceId: undefined }],
    ["profissional", { ...ctx, professionalId: undefined }],
    ["data", { ...ctx, date: undefined }],
    ["horário", { ...ctx, time: undefined }],
  ])("exige %s no contexto", async (_campo, partial) => {
    await expect(createBotAppointment(1, partial)).rejects.toThrow(
      "Dados insuficientes para criar agendamento",
    );
    expect(ClientModel.findOne).not.toHaveBeenCalled();
  });

  it("exige perfil de cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    await expect(createBotAppointment(1, ctx)).rejects.toThrow("Usuário não possui perfil de cliente");
  });

  it("exige profissional existente", async () => {
    happyPath();
    mocked(ProfessionalModel.findByPk).mockResolvedValue(null);
    await expect(createBotAppointment(1, ctx)).rejects.toThrow("Profissional não encontrado");
  });

  it.each([
    ["inexistente", null],
    ["inativo", { ...service, active: false }],
  ])("recusa serviço %s", async (_caso, svc) => {
    happyPath();
    mocked(ServiceModel.findByPk).mockResolvedValue(svc);
    await expect(createBotAppointment(1, ctx)).rejects.toThrow("Serviço inativo ou não encontrado");
  });

  it("recusa serviço de outro profissional", async () => {
    happyPath();
    mocked(ServiceModel.findByPk).mockResolvedValue({ ...service, professional_id: 8 });
    await expect(createBotAppointment(1, ctx)).rejects.toThrow(
      "Serviço não pertence ao profissional selecionado",
    );
  });

  it.each([[0], [Number.NaN]])("recusa duração inválida (%p)", async (duration) => {
    happyPath();
    mocked(ServiceModel.findByPk).mockResolvedValue({ ...service, duration });
    await expect(createBotAppointment(1, ctx)).rejects.toThrow("Duração do serviço inválida");
  });

  it("cria a reserva pendente com o endereço principal e avisa as duas partes", async () => {
    happyPath();

    const result = await createBotAppointment(1, ctx, START_ISO);

    expect(result).toBe(appointment);
    expect(AddressModel.findOne).not.toHaveBeenCalled();
    expect(withProfessionalScheduleLock).toHaveBeenCalledWith(4, expect.any(Function));
    expect(ServiceModel.findByPk).toHaveBeenLastCalledWith(3, { transaction });
    expect(getAvailableSlots).toHaveBeenCalledWith(4, DATE, 60, 3, { transaction });
    expect(AppointmentModel.create).toHaveBeenCalledWith(
      {
        professional_id: 4,
        client_id: 20,
        service_id: 3,
        address_id: 30,
        start_time: new Date(START_ISO),
        end_time: new Date("2030-01-07T14:00:00.000Z"),
        status: "pending",
      },
      { transaction },
    );
    expect(ensureChatRoomForAppointment).toHaveBeenCalledWith(appointment);
    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 40,
        title: "Novo Agendamento Recebido",
        message: 'Agendamento de Ana para "Pintura" em 07/01/2030 às 10:00.',
      }),
    );
    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 1,
        title: "Agendamento Criado",
        message: 'Seu agendamento para "Pintura" em 07/01/2030 às 10:00 foi criado.',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith("Bot: agendamento criado via chatbot", {
      appointmentId: 99,
      userId: 1,
    });
  });

  it("usa o primeiro endereço cadastrado quando não há endereço principal", async () => {
    happyPath();
    mocked(ClientModel.findOne).mockResolvedValue({ ...client, main_address_id: null });
    mocked(AddressModel.findOne).mockResolvedValue({ id: 31 });

    await createBotAppointment(1, ctx);

    expect(AddressModel.findOne).toHaveBeenCalledWith({ where: { user_id: 1 }, attributes: ["id"] });
    expect(AppointmentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ address_id: 31 }),
      { transaction },
    );
  });

  it("exige um endereço cadastrado", async () => {
    happyPath();
    mocked(ClientModel.findOne).mockResolvedValue({ ...client, main_address_id: null });
    mocked(AddressModel.findOne).mockResolvedValue(null);

    await expect(createBotAppointment(1, ctx)).rejects.toThrow(
      "Cadastre um endereço no seu perfil antes de agendar.",
    );
    expect(withProfessionalScheduleLock).not.toHaveBeenCalled();
  });

  it.each([
    ["foi desativado", { active: false }],
    ["mudou de profissional", { professional_id: 8 }],
    ["mudou de duração", { duration: 90 }],
  ])("recusa quando o serviço %s durante a reserva", async (_caso, change) => {
    happyPath();
    mocked(ServiceModel.findByPk)
      .mockResolvedValueOnce(service)
      .mockResolvedValueOnce({ ...service, ...change });

    await expect(createBotAppointment(1, ctx)).rejects.toThrow(
      "O serviço foi alterado. Escolha o horário novamente.",
    );
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("recusa quando o serviço some durante a reserva", async () => {
    happyPath();
    mocked(ServiceModel.findByPk).mockResolvedValueOnce(service).mockResolvedValueOnce(null);

    await expect(createBotAppointment(1, ctx)).rejects.toThrow("O serviço foi alterado.");
  });

  it("recusa horário que não está mais livre", async () => {
    happyPath();
    mocked(getAvailableSlots).mockResolvedValue(["11:00"]);

    await expect(createBotAppointment(1, ctx)).rejects.toThrow(
      "Horário  10:00  não está mais disponível. Por favor, escolha outro horário.",
    );
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("mantém a reserva quando a sala de chat e as notificações falham", async () => {
    happyPath();
    mocked(ensureChatRoomForAppointment).mockRejectedValue(new Error("mongo"));
    mocked(UserModel.findByPk).mockRejectedValue(new Error("db"));

    await expect(createBotAppointment(1, ctx)).resolves.toBe(appointment);
    expect(logger.warn).toHaveBeenCalledWith("Bot: falha ao criar chat_room para agendamento", {
      appointmentId: 99,
    });
    expect(logger.warn).toHaveBeenCalledWith("Bot: falha ao criar notificações do agendamento", {
      appointmentId: 99,
    });
  });

  it("não notifica usuários que não existem mais", async () => {
    happyPath();
    mocked(UserModel.findByPk).mockResolvedValue(null);

    await createBotAppointment(1, ctx);

    expect(NotificationModel.create).not.toHaveBeenCalled();
  });

  it("avisa o profissional com nome genérico quando o cliente não existe", async () => {
    happyPath();
    mocked(UserModel.findByPk).mockImplementation(async (id: number) =>
      id === 1 ? null : { id: 40 },
    );

    await createBotAppointment(1, ctx);

    expect(NotificationModel.create).toHaveBeenCalledTimes(1);
    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Agendamento de cliente") }),
    );
  });
});

describe("rescheduleBotAppointment", () => {
  const client = { id: 20 };
  const ctx: BotSessionContext = { appointmentId: 8, newDate: DATE, newTime: " 10:00 " };
  const original = {
    id: 8,
    client_id: 20,
    professional_id: 4,
    service_id: 3,
    status: "pending",
    payment_intent_id: null as string | null,
  };
  const current = () => ({
    ...original,
    start_time: new Date("2030-01-06T13:00:00.000Z"),
    end_time: new Date("2030-01-06T14:30:00.000Z"),
    save: jest.fn().mockResolvedValue(undefined),
  });

  it("exige perfil de cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    await expect(rescheduleBotAppointment(1, ctx)).rejects.toThrow(
      "Usuário não possui perfil de cliente",
    );
  });

  it("exige agendamento no contexto", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    await expect(rescheduleBotAppointment(1, { newDate: DATE, newTime: TIME })).rejects.toThrow(
      "Agendamento não encontrado",
    );
    expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
  });

  it("recusa agendamento de outro cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValue({ ...original, client_id: 99 });
    await expect(rescheduleBotAppointment(1, ctx)).rejects.toThrow("Agendamento não encontrado");
  });

  it.each([
    ["profissional", { professionalId: 5 }],
    ["serviço", { serviceId: 6 }],
  ])("exige manter o mesmo %s", async (_campo, change) => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValue(original);
    await expect(rescheduleBotAppointment(1, { ...ctx, ...change })).rejects.toThrow(
      "A remarcação deve manter o serviço e o profissional originais",
    );
  });

  it("exige nova data e horário", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValue(original);
    await expect(rescheduleBotAppointment(1, { appointmentId: 8, date: DATE })).rejects.toThrow(
      "Informe a nova data e horário",
    );
  });

  it.each([
    ["paga", { payment_intent_id: "pi_1" }],
    ["confirmada", { status: "confirmed" }],
  ])("transforma a remarcação de reserva %s em pedido ao profissional", async (_caso, change) => {
    const updated = { ...original, ...change, status: "reschedule_requested" };
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk)
      .mockResolvedValueOnce({ ...original, ...change })
      .mockResolvedValueOnce(updated);

    const result = await rescheduleBotAppointment(1, { ...ctx, professionalId: 4, serviceId: 3 });

    expect(requestReschedule).toHaveBeenCalledWith(1, "8", START_ISO);
    expect(withProfessionalScheduleLock).not.toHaveBeenCalled();
    expect(result).toBe(updated);
  });

  it("falha se a reserva some depois do pedido de reagendamento", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk)
      .mockResolvedValueOnce({ ...original, payment_intent_id: "pi_1" })
      .mockResolvedValueOnce(null);

    await expect(rescheduleBotAppointment(1, ctx)).rejects.toThrow("Agendamento não encontrado");
  });

  it("muda o horário da reserva não paga mantendo a duração contratada", async () => {
    const locked = current();
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValueOnce(original).mockResolvedValueOnce(locked);
    mocked(getAvailableSlots).mockResolvedValue(["10:00"]);

    const result = await rescheduleBotAppointment(1, ctx, START_ISO);

    expect(AppointmentModel.findByPk).toHaveBeenLastCalledWith(8, { transaction, lock: "UPDATE" });
    expect(getAvailableSlots).toHaveBeenCalledWith(4, DATE, 90, 3, {
      transaction,
      excludeAppointmentId: 8,
    });
    expect(result).toBe(locked);
    expect(locked.start_time).toEqual(new Date(START_ISO));
    expect(locked.end_time).toEqual(new Date("2030-01-07T14:30:00.000Z"));
    expect(locked.save).toHaveBeenCalledWith({ transaction });
    expect(logger.info).toHaveBeenCalledWith("Bot: reserva não paga remarcada via chatbot", {
      appointmentId: 8,
      userId: 1,
    });
  });

  it("usa date e time do contexto quando não há nova data", async () => {
    const locked = current();
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValueOnce(original).mockResolvedValueOnce(locked);
    mocked(getAvailableSlots).mockResolvedValue(["10:00"]);

    await rescheduleBotAppointment(1, { appointmentId: 8, date: DATE, time: TIME });

    expect(locked.save).toHaveBeenCalled();
  });

  it("não altera nada quando o horário é o mesmo", async () => {
    const locked = {
      ...current(),
      start_time: new Date(START_ISO),
      end_time: new Date("2030-01-07T14:30:00.000Z"),
    };
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValueOnce(original).mockResolvedValueOnce(locked);

    const result = await rescheduleBotAppointment(1, ctx);

    expect(result).toBe(locked);
    expect(getAvailableSlots).not.toHaveBeenCalled();
    expect(locked.save).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([
    ["sumiu", null, "Agendamento não encontrado"],
    ["trocou de cliente", { client_id: 99 }, "Agendamento não encontrado"],
    ["deixou de estar pendente", { status: "confirmed" }, "Este agendamento não pode ser remarcado por aqui"],
    ["foi paga", { payment_intent_id: "pi_2" }, "Este agendamento não pode ser remarcado por aqui"],
    ["tem duração inválida", { end_time: new Date("2030-01-06T13:00:00.000Z") }, "Duração do agendamento inválida"],
  ])("recusa quando a reserva %s sob a trava", async (_caso, change, message) => {
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(change === null ? null : { ...current(), ...change });

    await expect(rescheduleBotAppointment(1, ctx)).rejects.toThrow(message);
  });

  it("recusa horário ocupado", async () => {
    const locked = current();
    mocked(ClientModel.findOne).mockResolvedValue(client);
    mocked(AppointmentModel.findByPk).mockResolvedValueOnce(original).mockResolvedValueOnce(locked);
    mocked(getAvailableSlots).mockResolvedValue(["11:00"]);

    await expect(rescheduleBotAppointment(1, ctx)).rejects.toThrow(
      "Horário não está mais disponível. Por favor, escolha outro horário.",
    );
    expect(locked.save).not.toHaveBeenCalled();
  });
});

describe("cancelBotAppointment", () => {
  it("exige perfil de cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    await expect(cancelBotAppointment(1, 8)).rejects.toThrow("Usuário não possui perfil de cliente");
  });

  it.each([
    ["não existe", null],
    ["é de outro cliente", { id: 8, client_id: 99, status: "pending" }],
  ])("recusa agendamento que %s", async (_caso, appointment) => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 20 });
    mocked(AppointmentModel.findByPk).mockResolvedValue(appointment);
    await expect(cancelBotAppointment(1, 8)).rejects.toThrow("Agendamento não encontrado");
  });

  it.each([
    ["completed", "Não é possível cancelar um agendamento já concluído"],
    ["canceled", "Este agendamento já está cancelado"],
  ])("recusa agendamento %s", async (status, message) => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 20 });
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 8, client_id: 20, status });
    await expect(cancelBotAppointment(1, 8)).rejects.toThrow(message);
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

  it("cancela com a mesma regra do app", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 20 });
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 8, client_id: 20, status: "confirmed" });

    await cancelBotAppointment(1, 8);

    expect(cancelAppointment).toHaveBeenCalledWith(1, "8", "Cancelado pelo assistente virtual");
    expect(logger.info).toHaveBeenCalledWith("Bot: agendamento cancelado via chatbot", {
      appointmentId: 8,
      userId: 1,
    });
  });
});

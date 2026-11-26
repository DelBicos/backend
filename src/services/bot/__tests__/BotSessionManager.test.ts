jest.mock("../../../config/database");
jest.mock("../../../models/BotChatSession", () => ({
  BotChatSessionModel: { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("../../../models/BotChatMessage", () => ({
  BotChatMessageModel: { create: jest.fn(), findAll: jest.fn() },
}));
jest.mock("../../../models/Appointment", () => ({
  AppointmentModel: { findByPk: jest.fn() },
}));
jest.mock("../serviceChoice.helpers", () => ({
  migrateLegacyServiceOptions: jest.fn((context: unknown) => context),
}));

import type { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { BotChatSessionModel as SessionModel } from "../../../models/BotChatSession";
import { BotChatMessageModel } from "../../../models/BotChatMessage";
import { AppointmentModel } from "../../../models/Appointment";
import { migrateLegacyServiceOptions } from "../serviceChoice.helpers";
import { BotSessionManager } from "../BotSessionManager";

const findByPk = SessionModel.findByPk as jest.Mock;
const findOne = SessionModel.findOne as jest.Mock;
const createSession = SessionModel.create as jest.Mock;
const createMessage = BotChatMessageModel.create as jest.Mock;
const findMessages = BotChatMessageModel.findAll as jest.Mock;
const findAppointment = AppointmentModel.findByPk as jest.Mock;
const migrate = migrateLegacyServiceOptions as jest.Mock;

const HOUR = 60 * 60 * 1000;

type FakeSession = {
  id: number;
  user_id: number;
  auth_session_id: string;
  channel: string;
  status: string;
  state: string;
  context: BotSessionContext | null;
  started_at: Date;
  ended_at: Date | null;
  appointment_id: number | null;
  save: jest.Mock;
};

function fakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    id: 10,
    user_id: 1,
    auth_session_id: "auth-1",
    channel: "web",
    status: "active",
    state: "INICIO",
    context: {},
    started_at: new Date(),
    ended_at: null,
    appointment_id: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const asModel = (session: FakeSession) => session as unknown as BotChatSessionModel;

beforeEach(() => {
  jest.clearAllMocks();
  migrate.mockImplementation((context: unknown) => context);
});

describe("BotSessionManager.getOrCreateSession", () => {
  it("reutiliza a sessão pedida quando é do usuário e está ativa", async () => {
    const session = fakeSession();
    findByPk.mockResolvedValue(session);

    const result = await BotSessionManager.getOrCreateSession(1, "auth-1", "web", 10);

    expect(result).toBe(session);
    expect(findOne).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });

  it("ignora a sessão pedida de outro usuário e usa a última ativa", async () => {
    const latest = fakeSession({ id: 11 });
    findByPk.mockResolvedValue(fakeSession({ user_id: 2 }));
    findOne.mockResolvedValue(latest);

    const result = await BotSessionManager.getOrCreateSession(1, "auth-1", "web", 10);

    expect(result).toBe(latest);
    expect(findOne).toHaveBeenCalledWith({
      where: { user_id: 1, status: "active" },
      order: [["id", "DESC"]],
    });
  });

  it("encerra a sessão pedida que expirou e cria outra", async () => {
    const expired = fakeSession({ started_at: new Date(Date.now() - 25 * HOUR) });
    const created = fakeSession({ id: 12 });
    findByPk.mockResolvedValue(expired);
    findOne.mockResolvedValue(null);
    createSession.mockResolvedValue(created);

    const result = await BotSessionManager.getOrCreateSession(1, "auth-1", "mobile", 10);

    expect(expired.status).toBe("completed");
    expect(expired.ended_at).toBeInstanceOf(Date);
    expect(expired.save).toHaveBeenCalled();
    expect(result).toBe(created);
    expect(createSession).toHaveBeenCalledWith({
      user_id: 1,
      auth_session_id: "auth-1",
      channel: "mobile",
      status: "active",
      state: "INICIO",
      context: {},
    });
  });

  it("encerra a última sessão ativa expirada e cria outra com id derivado do usuário", async () => {
    const expired = fakeSession({ started_at: new Date(Date.now() - 48 * HOUR) });
    const created = fakeSession({ id: 13 });
    findOne.mockResolvedValue(expired);
    createSession.mockResolvedValue(created);

    const result = await BotSessionManager.getOrCreateSession(1, undefined, "web");

    expect(findByPk).not.toHaveBeenCalled();
    expect(expired.status).toBe("completed");
    expect(result).toBe(created);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ auth_session_id: "user:1" }),
    );
  });

  it("não expira sessão com data de início inválida", async () => {
    const session = fakeSession({ started_at: new Date("invalida") });
    findOne.mockResolvedValue(session);

    const result = await BotSessionManager.getOrCreateSession(1, "auth-1", "web");

    expect(result).toBe(session);
    expect(session.status).toBe("active");
  });

  it("atualiza o auth_session_id quando o login mudou", async () => {
    const session = fakeSession({ auth_session_id: "antigo" });
    findOne.mockResolvedValue(session);

    await BotSessionManager.getOrCreateSession(1, "novo", "web");

    expect(session.auth_session_id).toBe("novo");
    expect(session.save).toHaveBeenCalledTimes(1);
  });

  it("migra o contexto legado na escolha de serviço e reapresenta as opções", async () => {
    const legacy = { serviceOptionsData: [] } as unknown as BotSessionContext;
    const migrated = {
      serviceChoicesData: [{ title: "Pintura" }, { title: "Limpeza" }],
    } as unknown as BotSessionContext;
    const session = fakeSession({ state: "COLETANDO_SERVICO", context: legacy });
    findOne.mockResolvedValue(session);
    migrate.mockReturnValue(migrated);

    await BotSessionManager.getOrCreateSession(1, "auth-1", "web");

    expect(migrate).toHaveBeenCalledWith(legacy);
    expect(session.context).toBe(migrated);
    expect(session.save).toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledWith({
      session_id: 10,
      sender: "bot",
      content: expect.stringContaining("1. Pintura\n2. Limpeza"),
      intent: null,
      entities: null,
    });
  });

  it("migra o contexto sem escolhas sem enviar mensagem", async () => {
    const session = fakeSession({ state: "COLETANDO_SERVICO", context: null });
    findOne.mockResolvedValue(session);
    migrate.mockReturnValue({ serviceOptions: [] });

    await BotSessionManager.getOrCreateSession(1, "auth-1", "web");

    expect(migrate).toHaveBeenCalledWith({});
    expect(session.save).toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("não salva quando a migração não muda o contexto", async () => {
    const session = fakeSession({ state: "COLETANDO_SERVICO" });
    findOne.mockResolvedValue(session);

    await BotSessionManager.getOrCreateSession(1, "auth-1", "web");

    expect(migrate).toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });
});

describe("BotSessionManager.restartSession", () => {
  it("encerra a sessão atual e cria uma nova vazia no mesmo canal", async () => {
    const session = fakeSession({ channel: "voice-web", appointment_id: 5 });
    const created = fakeSession({ id: 20 });
    createSession.mockResolvedValue(created);

    const result = await BotSessionManager.restartSession(asModel(session), undefined);

    expect(session.status).toBe("completed");
    expect(session.ended_at).toBeInstanceOf(Date);
    expect(session.save).toHaveBeenCalled();
    expect(result).toBe(created);
    expect(createSession).toHaveBeenCalledWith({
      user_id: 1,
      auth_session_id: "user:1",
      channel: "voice-web",
      status: "active",
      state: "INICIO",
      context: {},
      appointment_id: null,
    });
  });

  it("usa o auth_session_id informado", async () => {
    createSession.mockResolvedValue(fakeSession());

    await BotSessionManager.restartSession(asModel(fakeSession()), "auth-9");

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ auth_session_id: "auth-9" }),
    );
  });
});

describe("BotSessionManager.saveSession", () => {
  it("atualiza estado, contexto e agendamento", async () => {
    const session = fakeSession({ appointment_id: 3 });

    await BotSessionManager.saveSession(asModel(session), "CONFIRMACAO", { date: "2030-01-01" }, null);

    expect(session.state).toBe("CONFIRMACAO");
    expect(session.context).toEqual({ date: "2030-01-01" });
    expect(session.appointment_id).toBeNull();
    expect(session.save).toHaveBeenCalled();
  });

  it("preserva o agendamento quando ele não é informado", async () => {
    const session = fakeSession({ appointment_id: 3 });

    await BotSessionManager.saveSession(asModel(session), "INICIO", {});

    expect(session.appointment_id).toBe(3);
  });
});

describe("BotSessionManager.createMessage", () => {
  it("grava intenção e entidades quando existem", async () => {
    await BotSessionManager.createMessage(10, "user", "oi", "SAUDACAO", { a: 1 });

    expect(createMessage).toHaveBeenCalledWith({
      session_id: 10,
      sender: "user",
      content: "oi",
      intent: "SAUDACAO",
      entities: { a: 1 },
    });
  });
});

describe("BotSessionManager.getHistory", () => {
  const message = {
    id: 1,
    sender: "bot",
    content: "Olá",
    intent: null,
    entities: null,
    createdAt: new Date("2030-01-01T10:00:00Z"),
  };

  it("devolve null sem sessão ativa", async () => {
    findOne.mockResolvedValue(null);

    await expect(BotSessionManager.getHistory(1)).resolves.toBeNull();
  });

  it("encerra a sessão expirada e devolve null", async () => {
    const expired = fakeSession({ started_at: new Date(Date.now() - 30 * HOUR) });
    findOne.mockResolvedValue(expired);

    await expect(BotSessionManager.getHistory(1)).resolves.toBeNull();
    expect(expired.status).toBe("completed");
    expect(findMessages).not.toHaveBeenCalled();
  });

  it("monta o histórico sem agendamento vinculado", async () => {
    const session = fakeSession({ context: null });
    findOne.mockResolvedValue(session);
    findMessages.mockResolvedValue([message]);

    const history = await BotSessionManager.getHistory(1);

    expect(findAppointment).not.toHaveBeenCalled();
    expect(findMessages).toHaveBeenCalledWith({
      where: { session_id: 10 },
      order: [["createdAt", "ASC"]],
    });
    expect(history).toEqual({
      session: expect.objectContaining({
        id: 10,
        context: {},
        appointment_status: null,
        appointment_paid: false,
        payment_pending: false,
        waiting_for_professional: false,
        poll_after_ms: null,
      }),
      messages: [message],
    });
  });

  it("pede nova consulta em 5s enquanto o profissional não responde", async () => {
    findOne.mockResolvedValue(fakeSession({ appointment_id: 7 }));
    findMessages.mockResolvedValue([]);
    findAppointment.mockResolvedValue({ status: "pending", payment_intent_id: null });

    const history = await BotSessionManager.getHistory(1);

    expect(findAppointment).toHaveBeenCalledWith(7, {
      attributes: ["id", "status", "payment_intent_id", "updatedAt"],
    });
    expect(history?.session).toMatchObject({
      appointment_status: "pending",
      waiting_for_professional: true,
      poll_after_ms: 5000,
    });
  });

  it("pede nova consulta em 10s quando confirmado e não pago", async () => {
    findOne.mockResolvedValue(fakeSession({ appointment_id: 7 }));
    findMessages.mockResolvedValue([]);
    findAppointment.mockResolvedValue({ status: "confirmed", payment_intent_id: null });

    const history = await BotSessionManager.getHistory(1);

    expect(history?.session).toMatchObject({
      payment_pending: true,
      appointment_paid: false,
      poll_after_ms: 10000,
    });
  });

  it("não pede nova consulta quando confirmado e pago", async () => {
    findOne.mockResolvedValue(fakeSession({ appointment_id: 7 }));
    findMessages.mockResolvedValue([]);
    findAppointment.mockResolvedValue({ status: "confirmed", payment_intent_id: "pi_1" });

    const history = await BotSessionManager.getHistory(1);

    expect(history?.session).toMatchObject({
      payment_pending: false,
      appointment_paid: true,
      poll_after_ms: null,
    });
  });

  it("trata agendamento vinculado que não existe mais", async () => {
    findOne.mockResolvedValue(fakeSession({ appointment_id: 7 }));
    findMessages.mockResolvedValue([]);
    findAppointment.mockResolvedValue(null);

    const history = await BotSessionManager.getHistory(1);

    expect(history?.session.appointment_status).toBeNull();
  });
});

describe("BotSessionManager.getHistoryBySessionId", () => {
  it("devolve null quando a sessão não existe", async () => {
    findByPk.mockResolvedValue(null);

    await expect(BotSessionManager.getHistoryBySessionId(10, 1)).resolves.toBeNull();
  });

  it("devolve null quando a sessão é de outro usuário", async () => {
    findByPk.mockResolvedValue(fakeSession({ user_id: 2 }));

    await expect(BotSessionManager.getHistoryBySessionId(10, 1)).resolves.toBeNull();
  });

  it("devolve o histórico mesmo de sessão encerrada", async () => {
    findByPk.mockResolvedValue(fakeSession({ status: "completed" }));
    findMessages.mockResolvedValue([]);

    const history = await BotSessionManager.getHistoryBySessionId(10, 1);

    expect(history?.session).toMatchObject({ id: 10, status: "completed" });
    expect(migrate).not.toHaveBeenCalled();
  });
});

describe("BotSessionManager - validade configurada", () => {
  const original = process.env.BOT_SESSION_TTL_HOURS;

  afterAll(() => {
    if (original === undefined) delete process.env.BOT_SESSION_TTL_HOURS;
    else process.env.BOT_SESSION_TTL_HOURS = original;
  });

  type Isolated = {
    manager: typeof BotSessionManager;
    sessions: { findOne: jest.Mock };
    messages: { findAll: jest.Mock };
  };

  const loadManager = (ttl: string): Isolated => {
    process.env.BOT_SESSION_TTL_HOURS = ttl;
    let isolated!: Isolated;
    jest.isolateModules(() => {
      isolated = {
        manager: (require("../BotSessionManager") as { BotSessionManager: typeof BotSessionManager })
          .BotSessionManager,
        sessions: (require("../../../models/BotChatSession") as {
          BotChatSessionModel: { findOne: jest.Mock };
        }).BotChatSessionModel,
        messages: (require("../../../models/BotChatMessage") as {
          BotChatMessageModel: { findAll: jest.Mock };
        }).BotChatMessageModel,
      };
    });
    return isolated;
  };

  it("respeita BOT_SESSION_TTL_HOURS válido", async () => {
    const { manager, sessions } = loadManager("1");
    const session = fakeSession({ started_at: new Date(Date.now() - 2 * HOUR) });
    sessions.findOne.mockResolvedValue(session);

    await expect(manager.getHistory(1)).resolves.toBeNull();
    expect(session.status).toBe("completed");
  });

  it("volta para 24h quando BOT_SESSION_TTL_HOURS é inválido", async () => {
    const { manager, sessions, messages } = loadManager("abc");
    const session = fakeSession({ started_at: new Date(Date.now() - 2 * HOUR) });
    sessions.findOne.mockResolvedValue(session);
    messages.findAll.mockResolvedValue([]);

    const history = await manager.getHistory(1);

    expect(history?.session.id).toBe(10);
    expect(session.status).toBe("active");
  });
});

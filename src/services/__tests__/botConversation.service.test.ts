jest.mock("../nlu.service", () => ({
  analyzeMessage: jest.fn(),
  isRestartCommand: jest.fn().mockReturnValue(false),
}));
jest.mock("../bot/BotSessionManager", () => ({
  BotSessionManager: {
    getOrCreateSession: jest.fn(),
    createMessage: jest.fn(),
    saveSession: jest.fn(),
    restartSession: jest.fn(),
    getHistory: jest.fn(),
    getHistoryBySessionId: jest.fn(),
  },
}));
jest.mock("../bot/BotMessageRouter", () => ({
  BotMessageRouter: { route: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  logError: jest.fn(),
}));

import { BotMessageRouter } from "../bot/BotMessageRouter";
import { BotSessionManager } from "../bot/BotSessionManager";
import {
  getActiveSessionHistory,
  getSessionHistory,
  processMessage,
} from "../botConversation.service";
import { analyzeMessage, isRestartCommand } from "../nlu.service";
import { logError } from "../../utils/logger";

describe("processMessage - saudação global", () => {
  beforeEach(() => jest.clearAllMocks());

  it("responde oi e preserva um agendamento que aguardava a data", async () => {
    const session = {
      id: 77,
      state: "COLETANDO_DATA",
      status: "active",
      channel: "web",
      context: {
        pendingAction: "CREATE",
        serviceName: "Limpeza residencial",
        matchedServiceIds: [10, 11],
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "SAUDACAO",
      entities: {},
      confidence: 1,
    });

    const result = await processMessage(1, "auth-1", "oi", 77, "web", undefined, "Asia/Tokyo");

    expect(result.state).toBe("COLETANDO_DATA");
    expect(result.message).toContain("Olá!");
    expect(result.message).toContain("Qual dia");
    expect(result.context).toMatchObject({
      serviceName: "Limpeza residencial",
      matchedServiceIds: [10, 11],
      timeZone: "America/Sao_Paulo",
    });
    expect(BotSessionManager.saveSession).toHaveBeenCalledWith(
      session,
      "COLETANDO_DATA",
      expect.objectContaining({ serviceName: "Limpeza residencial" }),
    );
    expect(BotMessageRouter.route).not.toHaveBeenCalled();
  });

  it.each(["SAUDACAO", "CONSULTAR", "ALTERAR"])(
    'mantém "10 da noite" na coleta de horário mesmo se o classificador responder %s',
    async (classifiedIntent) => {
    const session = {
      id: 83,
      state: "COLETANDO_HORARIO",
      status: "active",
      channel: "voice-web",
      context: {
        pendingAction: "CREATE",
        serviceName: "Desentupimento de pia ou ralo",
        matchedServiceIds: [73],
        date: "2026-09-26",
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: classifiedIntent,
      entities: {},
      confidence: 0.69,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Nenhum profissional está disponível às 22:00.",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: { suggestedSlots: ["16:00", "17:00"] },
    });

    const result = await processMessage(
      1,
      "auth-1",
      "10 da noite",
      83,
      "voice-web",
    );

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "COLETANDO_HORARIO",
      "10 da noite",
      expect.objectContaining({ intent: classifiedIntent }),
      session,
      1,
      undefined,
    );
    expect(result.message).toContain("22:00");
    expect(result.context).toMatchObject({
      serviceName: "Desentupimento de pia ou ralo",
      date: "2026-09-26",
    });
    },
  );

  it('continua tratando "boa noite" como saudação durante a coleta de horário', async () => {
    const session = {
      id: 84,
      state: "COLETANDO_HORARIO",
      status: "active",
      channel: "web",
      context: {
        pendingAction: "CREATE",
        serviceName: "Desentupimento de pia ou ralo",
        date: "2026-09-26",
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "SAUDACAO",
      entities: {},
      confidence: 1,
    });

    const result = await processMessage(
      1,
      "auth-1",
      "boa noite",
      84,
      "web",
    );

    expect(result.message).toContain("Olá!");
    expect(result.message).toContain("Qual horário");
    expect(BotMessageRouter.route).not.toHaveBeenCalled();
  });

  it("reinicia a coleta quando o usuário pede outro serviço no meio do fluxo", async () => {
    const session = {
      id: 78,
      state: "COLETANDO_DATA",
      status: "active",
      channel: "web",
      appointment_id: 999,
      context: {
        pendingAction: "CREATE",
        serviceName: "Limpeza residencial",
        matchedServiceIds: [10, 11],
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "AGENDAR",
      entities: { service: "pintura" },
      confidence: 1,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Perfeito! Para qual dia você quer o serviço?",
      nextState: "COLETANDO_DATA",
      contextUpdate: {
        pendingAction: "CREATE",
        serviceName: "Pintura",
        matchedServiceIds: [20],
      },
    });

    const result = await processMessage(
      1,
      "auth-1",
      "quero agendar pintura",
      78,
      "web",
    );

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "INICIO",
      "quero agendar pintura",
      expect.objectContaining({ intent: "AGENDAR" }),
      session,
      1,
      undefined,
    );
    expect(session.appointment_id).toBeNull();
    expect(result.context.serviceName).toBe("Pintura");
  });

  it('mantém "sábado que vem" na coleta de data mesmo se o classificador responder CONSULTAR', async () => {
    const session = {
      id: 82,
      state: "COLETANDO_DATA",
      status: "active",
      channel: "voice-web",
      appointment_id: null,
      context: {
        pendingAction: "CREATE",
        serviceName: "Conserto de Vazamentos",
        matchedServiceIds: [10],
        timeZone: "America/Sao_Paulo",
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "CONSULTAR",
      entities: {},
      confidence: 0.91,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Qual horário você prefere?",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: { date: "2026-09-26" },
    });

    const result = await processMessage(
      1,
      "auth-1",
      "sábado que vem",
      82,
      "voice-web",
    );

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "COLETANDO_DATA",
      "sábado que vem",
      expect.objectContaining({ intent: "CONSULTAR" }),
      session,
      1,
      undefined,
    );
    expect(result.state).toBe("COLETANDO_HORARIO");
    expect(result.context).toMatchObject({
      serviceName: "Conserto de Vazamentos",
      matchedServiceIds: [10],
      date: "2026-09-26",
    });
  });

  it("mantém a pergunta por horários disponíveis no fluxo da data escolhida", async () => {
    const session = {
      id: 80,
      state: "COLETANDO_HORARIO",
      status: "active",
      channel: "voice-web",
      appointment_id: null,
      context: {
        pendingAction: "CREATE",
        serviceName: "Conserto de Vazamentos",
        matchedServiceIds: [10],
        date: "2026-09-23",
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "CONSULTAR",
      entities: {},
      confidence: 0.91,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Tenho estes horários disponíveis: 09:00 • 14:30",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: { suggestedSlots: ["09:00", "14:30"] },
    });

    await processMessage(1, "auth-1", "quais os horários", 80, "voice-web");

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "COLETANDO_HORARIO",
      "quais os horários",
      expect.objectContaining({ intent: "CONSULTAR" }),
      session,
      1,
      undefined,
    );
  });

  it("continua tratando 'meus agendamentos' como consulta global", async () => {
    const session = {
      id: 81,
      state: "COLETANDO_HORARIO",
      status: "active",
      channel: "web",
      appointment_id: null,
      context: {
        pendingAction: "CREATE",
        serviceName: "Conserto de Vazamentos",
        matchedServiceIds: [10],
        date: "2026-09-23",
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "CONSULTAR",
      entities: {},
      confidence: 1,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Seus próximos agendamentos",
      nextState: "INICIO",
      contextUpdate: {},
    });

    await processMessage(1, "auth-1", "mostrar meus agendamentos", 81, "web");

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "INICIO",
      "mostrar meus agendamentos",
      expect.objectContaining({ intent: "CONSULTAR" }),
      session,
      1,
      undefined,
    );
  });

  it("remove o vínculo antigo ao pedir outro profissional sem serviço no contexto", async () => {
    const session = {
      id: 79,
      state: "CONFIRMACAO",
      status: "active",
      channel: "mobile",
      appointment_id: 999,
      context: {
        appointmentId: 999,
        appointmentStatus: "confirmed",
        appointmentPaid: true,
      },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(
      session,
    );

    const result = await processMessage(
      1,
      "auth-1",
      "outro profissional",
      79,
      "mobile",
    );

    expect(BotSessionManager.saveSession).toHaveBeenCalledWith(
      session,
      "INICIO",
      {},
      null,
    );
    expect(result.state).toBe("INICIO");
    expect(result.context).toEqual({});
  });
});

describe("processMessage - abertura de chamado de suporte", () => {
  beforeEach(() => jest.clearAllMocks());

  const ticketSession = (context: Record<string, unknown>) => ({
    id: 90,
    state: "INICIO",
    status: "active",
    channel: "web",
    appointment_id: null,
    context,
  });

  it.each([
    ["CANCELAR", "o profissional cancelou em cima da hora", "TICKET_DESCRIPTION"],
    ["SAUDACAO", "oi, o app travou", "TICKET_DESCRIPTION"],
    ["CANCELAR", "não, cancelar", "TICKET_CONFIRMATION"],
  ])(
    "não interrompe o chamado quando o classificador responde %s",
    async (intent, message, pendingPrompt) => {
      const session = ticketSession({
        intent: "SUPORTE",
        pendingPrompt,
        ticketDescription: "O app travou ao pagar",
      });
      (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
      (analyzeMessage as jest.Mock).mockResolvedValue({ intent, entities: {}, confidence: 1 });
      (BotMessageRouter.route as jest.Mock).mockResolvedValue({
        reply: "ok",
        nextState: "INICIO",
        contextUpdate: {},
      });

      await processMessage(1, "auth-1", message, 90);

      expect(BotMessageRouter.route).toHaveBeenCalledWith(
        "INICIO",
        message,
        expect.objectContaining({ intent }),
        expect.objectContaining({
          context: expect.objectContaining({ pendingPrompt }),
        }),
        1,
        undefined,
      );
    },
  );

  it("interrompe um agendamento em andamento quando o usuário pede suporte", async () => {
    const session = {
      id: 91,
      state: "COLETANDO_DATA",
      status: "active",
      channel: "web",
      appointment_id: 5,
      context: { pendingAction: "CREATE", serviceName: "Limpeza" },
    };
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "SUPORTE",
      entities: {},
      confidence: 1,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Descreva o problema",
      nextState: "INICIO",
      contextUpdate: { intent: "SUPORTE", pendingPrompt: "TICKET_DESCRIPTION" },
    });

    await processMessage(1, "auth-1", "quero abrir um chamado", 91);

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "INICIO",
      "quero abrir um chamado",
      expect.objectContaining({ intent: "SUPORTE" }),
      expect.objectContaining({ context: {}, appointment_id: null }),
      1,
      undefined,
    );
  });
});

describe("processMessage - comandos globais e encerramento", () => {
  beforeEach(() => jest.clearAllMocks());

  const baseSession = (overrides: Record<string, unknown> = {}) => ({
    id: 100,
    state: "INICIO",
    status: "active",
    channel: "web",
    appointment_id: null as number | null,
    ended_at: null as Date | null,
    context: {} as Record<string, unknown>,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it.each([["recomeçar", true], ["outro serviço", false], ["nova solicitação", false]])(
    'reinicia a conversa com "%s"',
    async (message, viaRestartCommand) => {
      const session = baseSession();
      const fresh = baseSession({ id: 101 });
      (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
      (BotSessionManager.restartSession as jest.Mock).mockResolvedValue(fresh);
      (isRestartCommand as jest.Mock).mockReturnValueOnce(viaRestartCommand);

      const result = await processMessage(1, "auth-1", message, 100);

      expect(BotSessionManager.restartSession).toHaveBeenCalledWith(session, "auth-1");
      expect(BotSessionManager.createMessage).toHaveBeenCalledWith(
        101,
        "bot",
        "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?",
      );
      expect(result).toEqual({
        sessionId: 101,
        message: "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?",
        state: "INICIO",
        context: {},
        clearHistory: true,
      });
      expect(analyzeMessage).not.toHaveBeenCalled();
    },
  );

  it("procura outro profissional para o mesmo serviço e limpa a escolha anterior", async () => {
    const session = baseSession({
      state: "CONFIRMACAO",
      appointment_id: 7,
      context: {
        serviceName: "Pintura",
        professionalId: 4,
        professionalName: "Joao",
        date: "2030-01-07",
        time: "10:00",
        appointmentId: 7,
      },
    });
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (BotSessionManager.saveSession as jest.Mock).mockImplementation(
      async (s: typeof session, state: string, context: Record<string, unknown>) => {
        s.state = state;
        s.context = context;
      },
    );
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Escolha um profissional",
      nextState: "SELECIONANDO_PROFISSIONAL",
      contextUpdate: { professionalOptionsData: [] },
    });

    const result = await processMessage(1, "auth-1", "Outro profissional", 100, "web", "iso");

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "COLETANDO_SERVICO",
      "Pintura",
      { intent: "AGENDAR", entities: { service: "Pintura" }, confidence: 1 },
      session,
      1,
      "iso",
    );
    const saved = (BotSessionManager.saveSession as jest.Mock).mock.calls[0];
    expect(saved[1]).toBe("SELECIONANDO_PROFISSIONAL");
    expect(saved[2]).toMatchObject({
      serviceName: "Pintura",
      professionalOptionsData: [],
      professionalId: undefined,
      date: undefined,
      appointmentId: undefined,
    });
    expect(saved[3]).toBeNull();
    expect(result.message).toBe(
      "Entendido. Vamos procurar outro profissional para esse serviço.\n\nEscolha um profissional",
    );
    expect(result.state).toBe("SELECIONANDO_PROFISSIONAL");
  });

  it("continua o agendamento em andamento quando o pedido é do mesmo serviço", async () => {
    const session = baseSession({
      state: "COLETANDO_DATA",
      context: {
        pendingAction: "CREATE",
        serviceName: "Limpeza residencial",
        serviceSubcategoryName: "Limpeza",
        serviceCategoryName: "Casa",
      },
    });
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "AGENDAR",
      entities: { service: "limpeza" },
      confidence: 1,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Para qual dia?",
      nextState: "COLETANDO_DATA",
      contextUpdate: {},
    });

    await processMessage(1, "auth-1", "quero limpeza", 100);

    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "COLETANDO_DATA",
      "quero limpeza",
      expect.anything(),
      session,
      1,
      undefined,
    );
  });

  it("trata como novo serviço quando o contexto não tem título, mesmo combinando com a categoria", async () => {
    const session = baseSession({
      state: "COLETANDO_HORARIO",
      context: {
        pendingAction: "CREATE",
        serviceSubcategoryName: "Encanamento",
        serviceCategoryName: "Reparos",
      },
    });
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (analyzeMessage as jest.Mock).mockResolvedValue({
      intent: "AGENDAR",
      entities: { service: "reparos" },
      confidence: 1,
    });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "ok",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {},
    });

    await processMessage(1, "auth-1", "quero agendar reparos", 100);

    // Sem título de serviço no contexto, qualquer serviço pedido conta como novo.
    expect((BotMessageRouter.route as jest.Mock).mock.calls[0][0]).toBe("INICIO");
  });

  it("responde com erro genérico quando o roteamento falha", async () => {
    const session = baseSession({ state: "COLETANDO_DATA", context: { serviceName: "Pintura" } });
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (analyzeMessage as jest.Mock).mockResolvedValue({ intent: "DESCONHECIDO", entities: {}, confidence: 0 });
    (BotMessageRouter.route as jest.Mock).mockRejectedValue(new Error("boom"));

    const result = await processMessage(1, "auth-1", "xyz", 100);

    expect(logError).toHaveBeenCalledWith(
      "Bot: erro inesperado no roteamento de mensagem",
      expect.any(Error),
      { userId: 1, sessionId: 100, state: "COLETANDO_DATA" },
    );
    expect(result.message).toBe("Desculpe, ocorreu um erro inesperado. Por favor, tente novamente.");
    expect(result.state).toBe("COLETANDO_DATA");
    expect(result.context).toMatchObject({ serviceName: "Pintura", timeZone: "America/Sao_Paulo" });
  });

  it("guarda o agendamento criado e encerra a sessão quando pedido", async () => {
    const session = baseSession({ state: "CONFIRMACAO", context: { serviceName: "Pintura" } });
    (BotSessionManager.getOrCreateSession as jest.Mock).mockResolvedValue(session);
    (analyzeMessage as jest.Mock).mockResolvedValue({ intent: "CONFIRMAR", entities: {}, confidence: 1 });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Agendado!",
      nextState: "AGUARDANDO_CONFIRMACAO",
      contextUpdate: {},
      appointmentId: 55,
      finalize: true,
    });

    const result = await processMessage(1, "auth-1", "sim", 100);

    expect(session.status).toBe("completed");
    expect(session.ended_at).toBeInstanceOf(Date);
    expect(BotSessionManager.saveSession).toHaveBeenCalledWith(
      session,
      "AGUARDANDO_CONFIRMACAO",
      expect.objectContaining({ appointmentId: 55 }),
      55,
    );
    expect(result).toMatchObject({ sessionId: 100, state: "AGUARDANDO_CONFIRMACAO" });
  });

  it.each([
    ["FINALIZADO", false],
    ["INICIO", true],
  ])("abre nova sessão quando o fluxo termina em %s", async (nextState, finalize) => {
    const session = baseSession({ state: "CONFIRMACAO", channel: "mobile" });
    const fresh = baseSession({ id: 200 });
    (BotSessionManager.getOrCreateSession as jest.Mock)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(fresh);
    (analyzeMessage as jest.Mock).mockResolvedValue({ intent: "CONFIRMAR", entities: {}, confidence: 1 });
    (BotMessageRouter.route as jest.Mock).mockResolvedValue({
      reply: "Até logo!",
      nextState,
      contextUpdate: {},
      finalize,
    });

    const result = await processMessage(1, "auth-1", "sim", 100, "mobile");

    expect(session.status).toBe("completed");
    expect(session.save).toHaveBeenCalled();
    expect(BotSessionManager.getOrCreateSession).toHaveBeenLastCalledWith(1, "auth-1", "mobile");
    expect(BotSessionManager.createMessage).toHaveBeenLastCalledWith(200, "bot", "Até logo!");
    expect(BotSessionManager.saveSession).not.toHaveBeenCalled();
    expect(result).toEqual({ sessionId: 200, message: "Até logo!", state: "INICIO", context: {} });
  });
});

describe("histórico da conversa", () => {
  beforeEach(() => jest.clearAllMocks());

  it("devolve o histórico da sessão do usuário", async () => {
    const history = { session: { id: 3 }, messages: [] };
    (BotSessionManager.getHistoryBySessionId as jest.Mock).mockResolvedValue(history);

    await expect(getSessionHistory(3, 1)).resolves.toBe(history);
    expect(BotSessionManager.getHistoryBySessionId).toHaveBeenCalledWith(3, 1);
  });

  it("falha quando a sessão não existe ou é de outro usuário", async () => {
    (BotSessionManager.getHistoryBySessionId as jest.Mock).mockResolvedValue(null);

    await expect(getSessionHistory(3, 1)).rejects.toThrow(
      "Histórico de sessão não encontrado ou não pertence a este usuário",
    );
  });

  it("devolve a última sessão ativa do usuário", async () => {
    (BotSessionManager.getHistory as jest.Mock).mockResolvedValue(null);

    await expect(getActiveSessionHistory(1)).resolves.toBeNull();
    expect(BotSessionManager.getHistory).toHaveBeenCalledWith(1);
  });
});

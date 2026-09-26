jest.mock("../nlu.service", () => ({
  analyzeMessage: jest.fn(),
  isRestartCommand: jest.fn().mockReturnValue(false),
}));
jest.mock("../bot/BotSessionManager", () => ({
  BotSessionManager: {
    getOrCreateSession: jest.fn(),
    createMessage: jest.fn(),
    saveSession: jest.fn(),
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
import { processMessage } from "../botConversation.service";
import { analyzeMessage } from "../nlu.service";

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

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

    const result = await processMessage(1, "auth-1", "oi", 77, "web");

    expect(result.state).toBe("COLETANDO_DATA");
    expect(result.message).toContain("Olá!");
    expect(result.message).toContain("Qual dia");
    expect(result.context).toMatchObject({
      serviceName: "Limpeza residencial",
      matchedServiceIds: [10, 11],
    });
    expect(BotSessionManager.saveSession).toHaveBeenCalledWith(
      session,
      "COLETANDO_DATA",
      expect.objectContaining({ serviceName: "Limpeza residencial" }),
    );
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

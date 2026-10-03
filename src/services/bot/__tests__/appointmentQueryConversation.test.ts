jest.mock("../../nlu.service", () => ({
  analyzeMessage: jest.fn(),
  isRestartCommand: () => false,
}));
jest.mock("../BotSessionManager", () => ({
  BotSessionManager: {
    getOrCreateSession: jest.fn(),
    createMessage: jest.fn(),
    saveSession: jest.fn(),
  },
}));
jest.mock("../BotMessageRouter.service", () => ({
  BotMessageRouter: { route: jest.fn() },
}));
jest.mock("../../../utils/logger", () => ({ logError: jest.fn() }));

import type { BotChatSessionModel } from "../../../models/BotChatSession";
import { analyzeMessage } from "../../nlu.service";
import { BotSessionManager } from "../BotSessionManager";
import { BotMessageRouter } from "../BotMessageRouter.service";
import { processMessage } from "../botConversation.service";

describe("CHAT-05: consulta global e continuidade", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(analyzeMessage)
      .mockResolvedValue({ intent: "CANCELAR", entities: {}, confidence: 0.8 });
    jest.mocked(BotMessageRouter.route).mockResolvedValue({
      reply: "Agendamentos cancelados",
      nextState: "INICIO",
      contextUpdate: {},
    });
  });

  it.each(["COLETANDO_ENDERECO", "COLETANDO_HORARIO", "CONFIRMACAO"])(
    "consulta serviços cancelados durante %s sem executar cancelamento",
    async (state) => {
      const session = {
        id: 1,
        state,
        status: "active",
        context: { pendingAction: "CREATE", bookingDetailsStep: "ADDRESS" },
      };
      jest
        .mocked(BotSessionManager.getOrCreateSession)
        .mockResolvedValue(session as BotChatSessionModel);
      await processMessage(7, "auth", "meus serviços cancelados", 1);
      expect(BotMessageRouter.route).toHaveBeenCalledWith(
        "INICIO",
        "meus serviços cancelados",
        expect.objectContaining({ intent: "CONSULTAR", entities: {} }),
        expect.objectContaining({ context: {} }),
        7,
        undefined,
      );
    },
  );

  it("mantém a página e o filtro anteriores para o handler avançar", async () => {
    const appointmentQuery = {
      statuses: ["canceled"],
      offset: 5,
      hasMore: true,
    };
    const session = {
      id: 1,
      state: "INICIO",
      status: "active",
      context: { appointmentQuery },
    };
    jest
      .mocked(BotSessionManager.getOrCreateSession)
      .mockResolvedValue(session as BotChatSessionModel);
    await processMessage(7, "auth", "ver mais agendamentos", 1);
    expect(BotMessageRouter.route).toHaveBeenCalledWith(
      "INICIO",
      "ver mais agendamentos",
      expect.objectContaining({ intent: "CONSULTAR" }),
      expect.objectContaining({ context: { appointmentQuery } }),
      7,
      undefined,
    );
  });
});

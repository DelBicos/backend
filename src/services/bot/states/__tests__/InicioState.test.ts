jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: {
    findAll: jest.fn(),
  },
}));

jest.mock("../../../../models/Client", () => ({
  ClientModel: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../../../models/Service", () => ({
  ServiceModel: {},
}));

import { AppointmentModel } from "../../../../models/Appointment";
import { ClientModel } from "../../../../models/Client";
import type { BotChatSessionModel } from "../../../../models/BotChatSession";
import type { NluResult } from "../../../nlu.service";
import { InicioState } from "../InicioState";

const fallbackNlu: NluResult = {
  intent: "FALLBACK",
  entities: {},
  confidence: 0.9,
};

describe("InicioState - oferta contextual de agendamento", () => {
  const state = new InicioState();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registra que aguarda confirmação quando a consulta não encontra agendamentos", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10 });
    (AppointmentModel.findAll as jest.Mock).mockResolvedValue([]);

    const result = await state.handle(
      "consultar agendamento",
      { intent: "CONSULTAR", entities: {}, confidence: 0.9 },
      { context: {} } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("INICIO");
    expect(result.contextUpdate.pendingPrompt).toBe(
      "OFFER_CREATE_AFTER_EMPTY_QUERY",
    );
  });

  it.each(["sim", "claro", "quero", "vamos", "pode ser"])(
    "inicia a coleta do serviço quando o usuário responde %s",
    async (answer) => {
      const result = await state.handle(
        answer,
        fallbackNlu,
        {
          context: { pendingPrompt: "OFFER_CREATE_AFTER_EMPTY_QUERY" },
        } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_SERVICO");
      expect(result.contextUpdate).toMatchObject({
        intent: "AGENDAR",
        pendingAction: "CREATE",
        pendingPrompt: undefined,
      });
    },
  );

  it("retorna ao menu quando o usuário recusa a oferta", async () => {
    const result = await state.handle(
      "agora não",
      fallbackNlu,
      {
        context: { pendingPrompt: "OFFER_CREATE_AFTER_EMPTY_QUERY" },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("INICIO");
    expect(result.contextUpdate.pendingPrompt).toBeUndefined();
  });
});

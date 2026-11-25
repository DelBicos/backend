jest.mock("../../../ticket/ticket.service", () => {
  class TicketOpeningNotAllowedError extends Error {}
  return {
    isAdmin: jest.fn().mockResolvedValue(false),
    openTicketFromChat: jest.fn(),
    TicketOpeningNotAllowedError,
  };
});

jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

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
import type {
  BotChatSessionModel,
  BotSessionContext,
} from "../../../../models/BotChatSession";
import {
  isAdmin,
  openTicketFromChat,
  TicketOpeningNotAllowedError,
} from "../../../ticket/ticket.service";
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

describe("InicioState - abertura de chamado de suporte", () => {
  const state = new InicioState();
  const supportNlu: NluResult = { intent: "SUPORTE", entities: {}, confidence: 1 };
  const sessionWith = (context: BotSessionContext) =>
    ({ context }) as BotChatSessionModel;
  const confirmationContext: BotSessionContext = {
    pendingPrompt: "TICKET_CONFIRMATION",
    ticketSummary: "Fui cobrado duas vezes no meu cartão",
    ticketDetails: "Foi no agendamento 6BDOKZ, ontem, R$ 120",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recusa o administrador antes de pedir a descrição", async () => {
    (isAdmin as jest.Mock).mockResolvedValueOnce(true);

    const result = await state.handle(
      "Fui cobrado duas vezes pelo serviço de ontem",
      supportNlu,
      sessionWith({}),
      1,
    );

    expect(isAdmin).toHaveBeenCalledWith(1);
    expect(result.reply).toContain("Administradores");
    expect(result.contextUpdate.pendingPrompt).toBeUndefined();
    expect(openTicketFromChat).not.toHaveBeenCalled();
  });

  it("pergunta qual é o problema quando o pedido de suporte é genérico", async () => {
    const result = await state.handle("quero abrir um chamado", supportNlu, sessionWith({}), 1);

    expect(result.nextState).toBe("INICIO");
    expect(result.reply).toContain("qual é o problema");
    expect(result.contextUpdate).toMatchObject({
      intent: "SUPORTE",
      pendingPrompt: "TICKET_DESCRIPTION",
    });
  });

  it("limpa cumprimentos e o pedido de suporte do relato e pede detalhes", async () => {
    const result = await state.handle(
      "Legal, porém foi cobrado duas vezes no meu cartão, eu gostaria de suporte técnico",
      supportNlu,
      sessionWith({}),
      1,
    );

    expect(result.reply).toContain('Entendi: "Foi cobrado duas vezes no meu cartão"');
    expect(result.reply).toContain("mais detalhes");
    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: "TICKET_DETAILS",
      ticketSummary: "Foi cobrado duas vezes no meu cartão",
    });
  });

  it("vai direto para a confirmação quando o relato já é detalhado", async () => {
    const result = await state.handle(
      "O pagamento do agendamento de ontem foi cobrado duas vezes no cartão e o estorno não apareceu",
      supportNlu,
      sessionWith({}),
      1,
    );

    expect(result.contextUpdate.pendingPrompt).toBe("TICKET_CONFIRMATION");
    expect(result.reply).toContain("Título: O pagamento do agendamento de ontem");
    expect(result.reply).toContain("Categoria: Pagamento");
  });

  it("usa a resposta da etapa do problema como resumo, mesmo com outra intenção", async () => {
    const result = await state.handle(
      "o profissional cancelou em cima da hora",
      { intent: "CANCELAR", entities: {}, confidence: 1 },
      sessionWith({ pendingPrompt: "TICKET_DESCRIPTION" }),
      1,
    );

    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: "TICKET_DETAILS",
      ticketSummary: "O profissional cancelou em cima da hora",
    });
  });

  it("pede mais detalhes quando o problema é curto demais", async () => {
    const result = await state.handle(
      "erro",
      fallbackNlu,
      sessionWith({ pendingPrompt: "TICKET_DESCRIPTION" }),
      1,
    );

    expect(result.reply).toContain("mais de detalhes");
    expect(result.contextUpdate).toEqual({});
  });

  it.each(["cancelar", "deixa pra lá", "Não"])(
    "desiste do chamado na etapa do problema: %s",
    async (answer) => {
      const result = await state.handle(
        answer,
        fallbackNlu,
        sessionWith({ pendingPrompt: "TICKET_DESCRIPTION" }),
        1,
      );

      expect(result.contextUpdate.pendingPrompt).toBeUndefined();
      expect(openTicketFromChat).not.toHaveBeenCalled();
    },
  );

  it("junta os detalhes à descrição e mostra a prévia do chamado", async () => {
    const result = await state.handle(
      "Foi no agendamento 6BDOKZ, ontem, R$ 120",
      fallbackNlu,
      sessionWith({
        pendingPrompt: "TICKET_DETAILS",
        ticketSummary: "Fui cobrado duas vezes no meu cartão",
      }),
      1,
    );

    expect(result.reply).toContain("Título: Fui cobrado duas vezes no meu cartão");
    expect(result.reply).toContain("Detalhes: Foi no agendamento 6BDOKZ, ontem, R$ 120");
    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: "TICKET_CONFIRMATION",
      ticketSummary: "Fui cobrado duas vezes no meu cartão",
      ticketDetails: "Foi no agendamento 6BDOKZ, ontem, R$ 120",
    });
  });

  it.each(["só isso", "não", "nada"])(
    "segue sem detalhes quando o usuário não tem o que acrescentar: %s",
    async (answer) => {
      const result = await state.handle(
        answer,
        fallbackNlu,
        sessionWith({
          pendingPrompt: "TICKET_DETAILS",
          ticketSummary: "Fui cobrado duas vezes no meu cartão",
        }),
        1,
      );

      expect(result.reply).not.toContain("Detalhes:");
      expect(result.contextUpdate).toMatchObject({
        pendingPrompt: "TICKET_CONFIRMATION",
        ticketDetails: undefined,
      });
    },
  );

  it("desiste do chamado na etapa dos detalhes", async () => {
    const result = await state.handle(
      "cancelar",
      fallbackNlu,
      sessionWith({
        pendingPrompt: "TICKET_DETAILS",
        ticketSummary: "Fui cobrado duas vezes no meu cartão",
      }),
      1,
    );

    expect(result.reply).toContain("não abri nenhum chamado");
    expect(result.contextUpdate.pendingPrompt).toBeUndefined();
  });

  it("abre o chamado e devolve o id e o código para o atalho do app", async () => {
    (openTicketFromChat as jest.Mock).mockResolvedValue({ id: 4, ticket_code: "TKT-8WZF" });

    const result = await state.handle("sim", fallbackNlu, sessionWith(confirmationContext), 9);

    expect(openTicketFromChat).toHaveBeenCalledWith(
      9,
      "Fui cobrado duas vezes no meu cartão",
      "Foi no agendamento 6BDOKZ, ontem, R$ 120",
    );
    expect(result.reply).toContain("TKT-8WZF");
    expect(result.reply).toContain("Ver chamado");
    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: undefined,
      ticketSummary: undefined,
      ticketDetails: undefined,
      ticketId: 4,
      ticketCode: "TKT-8WZF",
    });
  });

  it.each(["não", "não quero abrir", "cancelar"])(
    "não abre o chamado quando o usuário recusa: %s",
    async (answer) => {
      const result = await state.handle(answer, fallbackNlu, sessionWith(confirmationContext), 9);

      expect(openTicketFromChat).not.toHaveBeenCalled();
      expect(result.contextUpdate.pendingPrompt).toBeUndefined();
    },
  );

  it("mantém a confirmação pendente quando a abertura falha", async () => {
    (openTicketFromChat as jest.Mock).mockRejectedValue(new Error("db down"));

    const result = await state.handle("sim", fallbackNlu, sessionWith(confirmationContext), 9);

    expect(result.reply).toContain("tentar de novo");
    expect(result.contextUpdate).toEqual({});
  });

  it("informa o administrador que ele não abre chamados ao gravar", async () => {
    (openTicketFromChat as jest.Mock).mockRejectedValue(new TicketOpeningNotAllowedError());

    const result = await state.handle("sim", fallbackNlu, sessionWith(confirmationContext), 1);

    expect(result.reply).toContain("Administradores");
    expect(result.contextUpdate.pendingPrompt).toBeUndefined();
  });
});

describe("InicioState - encerramento da conversa", () => {
  const state = new InicioState();

  it.each([
    ["Somente, muito obrigado", "Não há de quê"],
    ["Somente", "Até logo"],
    ["Legal", "Combinado"],
    ["não", "Combinado"],
  ])("responde ao encerramento %p", async (message, expectedReply) => {
    const result = await state.handle(
      message,
      fallbackNlu,
      { context: {} } as BotChatSessionModel,
      1,
    );

    expect(result.reply).toContain(expectedReply);
    expect(result.nextState).toBe("INICIO");
  });

  it('trata "ok" diante da oferta de agendamento como confirmação', async () => {
    const result = await state.handle(
      "ok",
      fallbackNlu,
      {
        context: { pendingPrompt: "OFFER_CREATE_AFTER_EMPTY_QUERY" },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
  });
});

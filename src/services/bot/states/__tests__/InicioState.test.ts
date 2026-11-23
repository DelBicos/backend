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

  it("pede a descrição quando o pedido de suporte é genérico", async () => {
    const result = await state.handle("quero abrir um chamado", supportNlu, sessionWith({}), 1);

    expect(result.nextState).toBe("INICIO");
    expect(result.reply).toContain("Descreva o problema");
    expect(result.contextUpdate).toMatchObject({
      intent: "SUPORTE",
      pendingPrompt: "TICKET_DESCRIPTION",
    });
  });

  it("usa o relato do problema como descrição e pede confirmação", async () => {
    const result = await state.handle(
      "Fui cobrado duas vezes pelo serviço de ontem",
      supportNlu,
      sessionWith({}),
      1,
    );

    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: "TICKET_CONFIRMATION",
      ticketDescription: "Fui cobrado duas vezes pelo serviço de ontem",
    });
    expect(openTicketFromChat).not.toHaveBeenCalled();
  });

  it("guarda a descrição informada e pede confirmação, mesmo com outra intenção", async () => {
    const result = await state.handle(
      "o profissional cancelou em cima da hora",
      { intent: "CANCELAR", entities: {}, confidence: 1 },
      sessionWith({ pendingPrompt: "TICKET_DESCRIPTION" }),
      1,
    );

    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: "TICKET_CONFIRMATION",
      ticketDescription: "o profissional cancelou em cima da hora",
    });
  });

  it("pede mais detalhes quando a descrição é curta demais", async () => {
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
    "desiste do chamado na etapa de descrição: %s",
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

  it("abre o chamado quando o usuário confirma", async () => {
    (openTicketFromChat as jest.Mock).mockResolvedValue({ ticket_code: "TKT-AB12" });

    const result = await state.handle(
      "sim",
      fallbackNlu,
      sessionWith({
        pendingPrompt: "TICKET_CONFIRMATION",
        ticketDescription: "O app travou ao pagar",
      }),
      9,
    );

    expect(openTicketFromChat).toHaveBeenCalledWith(9, "O app travou ao pagar");
    expect(result.reply).toContain("TKT-AB12");
    expect(result.contextUpdate).toMatchObject({
      pendingPrompt: undefined,
      ticketDescription: undefined,
    });
  });

  it.each(["não", "não quero abrir", "cancelar"])(
    "não abre o chamado quando o usuário recusa: %s",
    async (answer) => {
      const result = await state.handle(
        answer,
        fallbackNlu,
        sessionWith({
          pendingPrompt: "TICKET_CONFIRMATION",
          ticketDescription: "O app travou ao pagar",
        }),
        9,
      );

      expect(openTicketFromChat).not.toHaveBeenCalled();
      expect(result.contextUpdate.pendingPrompt).toBeUndefined();
    },
  );

  it("mantém a confirmação pendente quando a abertura falha", async () => {
    (openTicketFromChat as jest.Mock).mockRejectedValue(new Error("db down"));

    const result = await state.handle(
      "sim",
      fallbackNlu,
      sessionWith({
        pendingPrompt: "TICKET_CONFIRMATION",
        ticketDescription: "O app travou ao pagar",
      }),
      9,
    );

    expect(result.reply).toContain("tentar de novo");
    expect(result.contextUpdate).toEqual({});
  });

  it("informa o administrador que ele não abre chamados", async () => {
    (openTicketFromChat as jest.Mock).mockRejectedValue(new TicketOpeningNotAllowedError());

    const result = await state.handle(
      "sim",
      fallbackNlu,
      sessionWith({
        pendingPrompt: "TICKET_CONFIRMATION",
        ticketDescription: "O app travou ao pagar",
      }),
      1,
    );

    expect(result.reply).toContain("Administradores");
    expect(result.contextUpdate.pendingPrompt).toBeUndefined();
  });
});

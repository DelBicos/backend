jest.mock("../../../models/Appointment", () => ({
  AppointmentModel: { findAll: jest.fn() },
}));
jest.mock("../../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../../models/Service", () => ({
  ServiceModel: { findAll: jest.fn() },
}));
jest.mock("../../../models/Subcategory", () => ({
  SubCategoryModel: { findAll: jest.fn() },
}));
jest.mock("../../../models/Category", () => ({
  CategoryModel: { findAll: jest.fn() },
}));
jest.mock("../../../models/Professional", () => ({
  ProfessionalModel: {},
}));
jest.mock("../../../models/User", () => ({
  UserModel: {},
}));
jest.mock("../../../models/Address", () => ({
  AddressModel: {},
}));
jest.mock("../../semanticSearch.service", () => ({
  rankSemanticCandidates: jest.fn(),
  SemanticSearchUnavailableError: class SemanticSearchUnavailableError extends Error {},
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

jest.mock("../states/ColetandoDataState", () => ({
  ColetandoDataState: class ColetandoDataState {
    public async handle() {
      throw new Error("ColetandoDataState não deveria ser chamado neste teste");
    }
  },
}));
jest.mock("../states/ColetandoHorarioState", () => ({
  ColetandoHorarioState: class ColetandoHorarioState {
    public async handle() {
      throw new Error(
        "ColetandoHorarioState não deveria ser chamado neste teste",
      );
    }
  },
}));
jest.mock("../states/ConfirmacaoState", () => ({
  ConfirmacaoState: class ConfirmacaoState {
    public async handle() {
      throw new Error("ConfirmacaoState não deveria ser chamado neste teste");
    }
  },
}));
jest.mock("../states/AguardandoIdAgendamentoState", () => ({
  AguardandoIdAgendamentoState: class AguardandoIdAgendamentoState {
    public async handle() {
      throw new Error(
        "AguardandoIdAgendamentoState não deveria ser chamado neste teste",
      );
    }
  },
}));
jest.mock("../states/AguardandoConfirmacaoState", () => ({
  AguardandoConfirmacaoState: class AguardandoConfirmacaoState {
    public async handle() {
      throw new Error(
        "AguardandoConfirmacaoState não deveria ser chamado neste teste",
      );
    }
  },
}));
jest.mock("../states/SelecionandoProfissionalState", () => ({
  SelecionandoProfissionalState: class SelecionandoProfissionalState {
    public async handle() {
      throw new Error(
        "SelecionandoProfissionalState não deveria ser chamado neste teste",
      );
    }
  },
}));

import { BotState } from "../../../constants/botStates";
import type { BotChatSessionModel } from "../../../models/BotChatSession";
import { ClientModel } from "../../../models/Client";
import { CategoryModel } from "../../../models/Category";
import { ServiceModel } from "../../../models/Service";
import { SubCategoryModel } from "../../../models/Subcategory";
import { rankSemanticCandidates } from "../../semanticSearch.service";
import type { NluResult } from "../../nlu.service";
import { BotMessageRouter } from "../BotMessageRouter";

function serviceFixture(
  id: number,
  title: string,
  subcategoryId: number,
  subcategoryName: string,
) {
  return {
    id,
    title,
    description: `Serviço de ${title}`,
    subcategory_id: subcategoryId,
    professional_id: id + 1000,
    price_cents: 10000,
    duration: 60,
    Subcategory: {
      id: subcategoryId,
      title: subcategoryName,
      Category: { id: subcategoryId + 100, title: "Categoria" },
    },
    Professional: {
      User: { name: `Profissional ${id}`, avatar_uri: null },
      MainAddress: { city: "São Paulo", state: "SP" },
    },
    Appointments: [],
  };
}

function subcategoryFixture(id: number, title: string) {
  return {
    id,
    title,
    active: true,
    category_id: id + 100,
    Category: {
      id: id + 100,
      title: "Categoria",
      active: true,
    },
  };
}

function sessionFixture(): BotChatSessionModel {
  return { context: {} } as BotChatSessionModel;
}

function fallbackNlu(): NluResult {
  return { intent: "FALLBACK", entities: {}, confidence: 0.8 };
}

describe("BotMessageRouter no estado INICIO", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([]);
    (CategoryModel.findAll as jest.Mock).mockResolvedValue([]);
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([]);
  });

  it.each([
    {
      message: "Cabeleleiro",
      nlu: fallbackNlu(),
    },
    {
      message: "quero cabeleleiro",
      // O classificador real devolve FALLBACK para esta frase; o roteador
      // ainda deve consultar o catálogo pelo texto completo.
      nlu: fallbackNlu(),
    },
  ])(
    "reconhece cabelo sem oferta a partir de '$message'",
    async ({ message, nlu }) => {
      (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
        subcategoryFixture(300, "Cabelo & Barba"),
      ]);

      const result = await BotMessageRouter.route(
        BotState.INICIO,
        message,
        nlu,
        sessionFixture(),
        1,
      );

      expect(result.nextState).toBe(BotState.COLETANDO_SERVICO);
      expect(result.reply).toContain("Cabelo & Barba");
      expect(result.reply).toMatch(/não.*serviços.*disponíveis/i);
    },
  );

  it("roteia tomada para a seleção entre serviço comum e inteligente", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(310, "Instalação de Tomadas", 310, "Eletricista"),
      serviceFixture(
        311,
        "Instalação de Tomada Inteligente",
        310,
        "Eletricista",
      ),
    ]);

    const result = await BotMessageRouter.route(
      BotState.INICIO,
      "tomada",
      fallbackNlu(),
      sessionFixture(),
      1,
    );

    expect(result.nextState).toBe(BotState.COLETANDO_SERVICO);
    expect(result.reply).toContain("Instalação de Tomadas");
    expect(result.reply).toContain("Instalação de Tomada Inteligente");
    expect(result.contextUpdate.serviceChoicesData).toHaveLength(2);
  });

  it("roteia pia entupida e agrupa as ofertas singular/plural", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(320, "Desentupimento de Pia", 320, "Encanador"),
      serviceFixture(321, "Desentupimento de Pias", 320, "Encanador"),
    ]);

    const result = await BotMessageRouter.route(
      BotState.INICIO,
      "pia entupida",
      fallbackNlu(),
      sessionFixture(),
      1,
    );

    expect(result.nextState).toBe(BotState.COLETANDO_DATA);
    expect(result.contextUpdate.matchedServiceIds).toEqual([320, 321]);
  });

  it.each([
    {
      message: "conserto de celular",
      nlu: fallbackNlu(),
    },
    {
      message: "manutenção de computador",
      nlu: fallbackNlu(),
    },
    {
      message: "instalação de internet",
      nlu: fallbackNlu(),
    },
    {
      message: "limpeza de pele",
      nlu: {
        intent: "AGENDAR",
        entities: {},
        confidence: 0.8,
      } as NluResult,
    },
  ])(
    "responde claramente quando '$message' não existe no catálogo",
    async ({ message, nlu }) => {
      const result = await BotMessageRouter.route(
        BotState.INICIO,
        message,
        nlu,
        sessionFixture(),
        1,
      );

      expect(result.nextState).toBe(BotState.COLETANDO_SERVICO);
      expect(result.serviceSearchOutcome).toBe("NOT_FOUND");
      expect(result.reply).toContain(
        "Não encontrei serviços nem profissionais",
      );
      expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    },
  );

  it.each([
    {
      message: "oi",
      nlu: {
        intent: "SAUDACAO",
        entities: {},
        confidence: 1,
      } as NluResult,
    },
    { message: "como você está", nlu: fallbackNlu() },
    { message: "obrigado", nlu: fallbackNlu() },
  ])(
    "mantém conversa casual '$message' no INICIO",
    async ({ message, nlu }) => {
      const result = await BotMessageRouter.route(
        BotState.INICIO,
        message,
        nlu,
        sessionFixture(),
        1,
      );

      expect(result.nextState).toBe(BotState.INICIO);
      expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    },
  );

  it.each([
    {
      message: "cancelar tomada",
      nlu: {
        intent: "CANCELAR",
        entities: {},
        confidence: 1,
      } as NluResult,
      expectedIntent: "CANCELAR",
    },
    {
      message: "reagendar pia entupida",
      nlu: {
        intent: "ALTERAR",
        entities: {},
        confidence: 1,
      } as NluResult,
      expectedIntent: "ALTERAR",
    },
  ])(
    "preserva a precedência da ação global em '$message'",
    async ({ message, nlu, expectedIntent }) => {
      const result = await BotMessageRouter.route(
        BotState.INICIO,
        message,
        nlu,
        sessionFixture(),
        1,
      );

      expect(result.nextState).toBe(BotState.AGUARDANDO_ID_AGENDAMENTO);
      expect(result.contextUpdate.intent).toBe(expectedIntent);
      expect(ServiceModel.findAll).not.toHaveBeenCalled();
    },
  );

  it.each([
    "quero agendar",
    "quero agenda",
    "quero ageda",
    "quero agedar",
    "quero ajendar",
    "quero agendr",
    "quero fazer um agendamento",
    "quero fazer um novo agendamento",
  ])("preserva o pedido global sem serviço: '%s'", async (message) => {
    const result = await BotMessageRouter.route(
      BotState.INICIO,
      message,
      { intent: "AGENDAR", entities: {}, confidence: 1 },
      sessionFixture(),
      1,
    );

    expect(result.nextState).toBe(BotState.COLETANDO_SERVICO);
    expect(result.reply).toContain("Qual serviço");
    expect(ServiceModel.findAll).not.toHaveBeenCalled();
  });

  it("ainda pesquisa o serviço presente após o verbo com erro", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(330, "Montagem de Móveis", 330, "Marido de Aluguel"),
    ]);

    const result = await BotMessageRouter.route(
      BotState.INICIO,
      "quero ageda montagem de móveis",
      {
        intent: "AGENDAR",
        entities: { service: "montagem de móveis" },
        confidence: 1,
      },
      sessionFixture(),
      1,
    );

    expect(result.nextState).toBe(BotState.COLETANDO_DATA);
    expect(result.contextUpdate.matchedServiceIds).toEqual([330]);
  });
});

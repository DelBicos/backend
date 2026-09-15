jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: {},
}));
jest.mock("../../../../models/Service", () => ({
  ServiceModel: { findAll: jest.fn() },
}));
jest.mock("../../../../models/Subcategory", () => ({
  SubCategoryModel: { findAll: jest.fn() },
}));
jest.mock("../../../../models/Category", () => ({
  CategoryModel: { findAll: jest.fn() },
}));
jest.mock("../../../../models/Professional", () => ({
  ProfessionalModel: {},
}));
jest.mock("../../../../models/User", () => ({
  UserModel: {},
}));
jest.mock("../../../../models/Address", () => ({
  AddressModel: {},
}));
jest.mock("../../../semanticSearch.service", () => ({
  rankSemanticCandidates: jest.fn(),
  SemanticSearchUnavailableError: class SemanticSearchUnavailableError extends Error {},
}));
jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

import type {
  BotChatSessionModel,
  BotServiceChoice,
} from "../../../../models/BotChatSession";
import { CategoryModel } from "../../../../models/Category";
import { ServiceModel } from "../../../../models/Service";
import { SubCategoryModel } from "../../../../models/Subcategory";
import {
  rankSemanticCandidates,
  SemanticSearchUnavailableError,
} from "../../../semanticSearch.service";
import { ColetandoServicoState } from "../ColetandoServicoState";

function serviceFixture(
  id: number,
  professionalName: string,
  overrides: {
    title?: string;
    description?: string;
    subcategoryId?: number;
    subcategoryName?: string;
    categoryName?: string;
  } = {},
) {
  return {
    id,
    title: overrides.title ?? "Limpeza residencial",
    description: overrides.description ?? "Limpeza completa",
    subcategory_id: overrides.subcategoryId ?? 7,
    professional_id: id + 100,
    price_cents: 15000,
    duration: 120,
    Subcategory: {
      title: overrides.subcategoryName ?? "Limpeza",
      Category: { title: overrides.categoryName ?? "Casa" },
    },
    Professional: {
      User: { name: professionalName, avatar_uri: null },
      MainAddress: { city: "São Paulo", state: "SP" },
    },
    Appointments: [],
  };
}

function subcategoryFixture(id: number, title: string, categoryName: string) {
  return {
    id,
    title,
    description: `Serviços profissionais de ${title}`,
    active: true,
    category_id: id + 100,
    Category: {
      id: id + 100,
      title: categoryName,
      active: true,
    },
  };
}

function staleServiceChoicesFixture(): BotServiceChoice[] {
  return [
    {
      title: "Reboco e Emboço",
      description: "Aplicação de reboco em paredes",
      subcategoryId: 20,
      subcategoryName: "Reparos e Reformas",
      categoryName: "Construção",
      matchedServiceIds: [20],
    },
    {
      title: "Construção de Muros",
      description: "Construção e acabamento de muros",
      subcategoryId: 21,
      subcategoryName: "Reparos e Reformas",
      categoryName: "Construção",
      matchedServiceIds: [21],
    },
    {
      title: "Unhas de Gel",
      description: "Alongamento e manutenção de unhas",
      subcategoryId: 22,
      subcategoryName: "Unhas",
      categoryName: "Beleza",
      matchedServiceIds: [22],
    },
  ];
}

describe("ColetandoServicoState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([]);
    (CategoryModel.findAll as jest.Mock).mockResolvedValue([]);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([]);
  });

  it("agrupa o mesmo serviço e pede a data antes de mostrar profissionais", async () => {
    const services = [serviceFixture(10, "Ana"), serviceFixture(11, "Bruno")];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 10, score: 0.98 },
      { id: 11, score: 0.97 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "Limpeza residencial",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: { pendingAction: "CREATE" },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.contextUpdate.matchedServiceIds).toEqual([10, 11]);
    expect(result.reply).toContain("Para qual dia");
    expect(result.reply).not.toContain("Ana");
    expect(result.reply).not.toContain("Bruno");
    expect(result.contextUpdate.professionalId).toBeUndefined();
  });

  it("informa a taxonomia Cabelo & Barba sem oferta e não oferece serviços alheios para Cabeleleiro", async () => {
    const services = [
      serviceFixture(20, "Ana", {
        title: "Reboco e Emboço",
        description: "Aplicação de reboco em paredes",
        subcategoryId: 20,
        subcategoryName: "Reparos e Reformas",
        categoryName: "Construção",
      }),
      serviceFixture(21, "Bruno", {
        title: "Construção de Muros",
        description: "Construção e acabamento de muros",
        subcategoryId: 21,
        subcategoryName: "Reparos e Reformas",
        categoryName: "Construção",
      }),
      serviceFixture(22, "Carla", {
        title: "Unhas de Gel",
        description: "Alongamento e manutenção de unhas",
        subcategoryId: 22,
        subcategoryName: "Unhas",
        categoryName: "Beleza",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(23, "Cabelo & Barba", "Beleza & Estética"),
    ]);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 20, score: 0.359537 },
      { id: 21, score: 0.354336 },
      { id: 22, score: 0.35057 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "Cabeleleiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Cabelo & Barba");
    expect(result.reply).toMatch(/não.*serviços.*disponíveis/i);
    expect(result.reply).not.toContain("Reboco e Emboço");
    expect(result.reply).not.toContain("Construção de Muros");
    expect(result.reply).not.toContain("Unhas de Gel");
    expect(result.reply).not.toContain("Ana");
    expect(result.reply).not.toContain("Bruno");
    expect(result.reply).not.toContain("Carla");
    expect(result.contextUpdate).toHaveProperty("serviceOptions", undefined);
    expect(result.contextUpdate).toHaveProperty(
      "serviceOptionsData",
      undefined,
    );
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
  });

  it("abandona serviceChoicesData obsoletos quando o texto não casa e refaz a busca pela taxonomia", async () => {
    const staleChoices = staleServiceChoicesFixture();
    const professionalNames = ["Ana", "Bruno", "Carla"];
    const services = staleChoices.map((choice, index) =>
      serviceFixture(choice.matchedServiceIds[0], professionalNames[index], {
        title: choice.title,
        description: choice.description ?? undefined,
        subcategoryId: choice.subcategoryId,
        subcategoryName: choice.subcategoryName,
        categoryName: choice.categoryName ?? undefined,
      }),
    );
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(23, "Cabelo & Barba", "Beleza & Estética"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "Cabeleleiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: {
          pendingAction: "CREATE",
          serviceOptions: staleChoices.map((choice) => choice.title),
          serviceChoicesData: staleChoices,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(ServiceModel.findAll).toHaveBeenCalledTimes(1);
    expect(SubCategoryModel.findAll).toHaveBeenCalledTimes(1);
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Cabelo & Barba");
    expect(result.reply).toMatch(/não.*serviços.*disponíveis/i);
    expect(result.reply).not.toContain("Reboco e Emboço");
    expect(result.reply).not.toContain("Construção de Muros");
    expect(result.reply).not.toContain("Unhas de Gel");
    expect(result.contextUpdate).toHaveProperty("serviceOptions", undefined);
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
  });

  it("mantém as opções atuais quando recebe um número inválido", async () => {
    const staleChoices = staleServiceChoicesFixture();

    const result = await new ColetandoServicoState().handle(
      "9",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: {
          pendingAction: "CREATE",
          serviceOptions: staleChoices.map((choice) => choice.title),
          serviceChoicesData: staleChoices,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não identifiquei essa opção");
    expect(result.reply).toContain("Reboco e Emboço");
    expect(result.reply).toContain("Construção de Muros");
    expect(result.reply).toContain("Unhas de Gel");
    expect(ServiceModel.findAll).not.toHaveBeenCalled();
    expect(SubCategoryModel.findAll).not.toHaveBeenCalled();
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
  });

  it.each([
    {
      input: "2",
      expectedTitle: "Construção de Muros",
      expectedServiceIds: [21],
    },
    {
      input: "unhas de gel",
      expectedTitle: "Unhas de Gel",
      expectedServiceIds: [22],
    },
  ])(
    "preserva a seleção válida por número ou nome: '$input'",
    async ({ input, expectedTitle, expectedServiceIds }) => {
      const staleChoices = staleServiceChoicesFixture();

      const result = await new ColetandoServicoState().handle(
        input,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        {
          context: {
            pendingAction: "CREATE",
            serviceOptions: staleChoices.map((choice) => choice.title),
            serviceChoicesData: staleChoices,
          },
        } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain(`Vamos agendar "${expectedTitle}"`);
      expect(result.contextUpdate.matchedServiceIds).toEqual(
        expectedServiceIds,
      );
      expect(ServiceModel.findAll).not.toHaveBeenCalled();
      expect(SubCategoryModel.findAll).not.toHaveBeenCalled();
      expect(rankSemanticCandidates).not.toHaveBeenCalled();
    },
  );

  it.each(["2.", "opção 2"])(
    "aceita a seleção atual escrita como '%s'",
    async (input) => {
      const staleChoices = staleServiceChoicesFixture();

      const result = await new ColetandoServicoState().handle(
        input,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        {
          context: {
            pendingAction: "CREATE",
            serviceOptions: staleChoices.map((choice) => choice.title),
            serviceChoicesData: staleChoices,
          },
        } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain('Vamos agendar "Construção de Muros"');
      expect(result.contextUpdate.matchedServiceIds).toEqual([21]);
      expect(ServiceModel.findAll).not.toHaveBeenCalled();
      expect(SubCategoryModel.findAll).not.toHaveBeenCalled();
      expect(rankSemanticCandidates).not.toHaveBeenCalled();
    },
  );

  it("não interpreta '2/9' como uma seleção válida e mantém as opções atuais", async () => {
    const staleChoices = staleServiceChoicesFixture();

    const result = await new ColetandoServicoState().handle(
      "2/9",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: {
          pendingAction: "CREATE",
          serviceOptions: staleChoices.map((choice) => choice.title),
          serviceChoicesData: staleChoices,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não identifiquei essa opção");
    expect(result.reply).toContain("Reboco e Emboço");
    expect(result.reply).toContain("Construção de Muros");
    expect(result.reply).toContain("Unhas de Gel");
    expect(result.reply).not.toContain('Vamos agendar "Construção de Muros"');
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(ServiceModel.findAll).not.toHaveBeenCalled();
    expect(SubCategoryModel.findAll).not.toHaveBeenCalled();
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
  });

  it("refaz a busca por reforma de banheiro em vez de selecionar Limpeza pós Reforma da lista antiga", async () => {
    const staleChoices: BotServiceChoice[] = [
      {
        title: "Limpeza pós Reforma",
        description: "Limpeza depois de obras e reformas",
        subcategoryId: 90,
        subcategoryName: "Limpeza pós Obra",
        categoryName: "Reformas & Reparos",
        matchedServiceIds: [90],
      },
      ...staleServiceChoicesFixture().slice(0, 2),
    ];
    const activeService = serviceFixture(91, "Profissional correto", {
      title: "Reforma de Banheiro",
      description: "Reforma completa de banheiro",
      subcategoryId: 91,
      subcategoryName: "Pedreiro",
      categoryName: "Reformas & Reparos",
    });
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([activeService]);

    const result = await new ColetandoServicoState().handle(
      "reforma de banheiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: {
          pendingAction: "CREATE",
          serviceOptions: staleChoices.map((choice) => choice.title),
          serviceChoicesData: staleChoices,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(ServiceModel.findAll).toHaveBeenCalledTimes(1);
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Reforma de Banheiro"');
    expect(result.reply).not.toContain('Vamos agendar "Limpeza pós Reforma"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([91]);
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
  });

  it("não avança para a data quando há somente um resultado semântico fraco", async () => {
    const services = [
      serviceFixture(30, "Ana", {
        title: "Reboco e Emboço",
        subcategoryId: 30,
        subcategoryName: "Reparos e Reformas",
        categoryName: "Construção",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 30, score: 0.36 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "Cabeleleiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não encontrei serviços");
    expect(result.reply).not.toContain("Para qual dia");
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
    expect(rankSemanticCandidates).toHaveBeenCalledTimes(1);
  });

  it("não confunde cabeamento com a taxonomia Cabelo & Barba", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(31, "Cabelo & Barba", "Beleza & Estética"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "cabeamento",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não encontrei serviços");
    expect(result.reply).toContain("cabeamento");
    expect(result.reply).not.toContain("Cabelo & Barba");
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
  });

  it.each([
    {
      query: "montanha",
      id: 32,
      title: "Montagem de Móveis",
      subcategoryName: "Marido de Aluguel",
    },
    {
      query: "manivela",
      id: 33,
      title: "Manicure Completa",
      subcategoryName: "Manicure",
    },
    {
      query: "personalidade",
      id: 34,
      title: "Personal Organizer",
      subcategoryName: "Personal Organizer",
    },
    {
      query: "organismo",
      id: 35,
      title: "Organização de Ambientes",
      subcategoryName: "Personal Organizer",
    },
  ])(
    "não aceita o falso positivo lexical '$query' como '$title'",
    async ({ query, id, title, subcategoryName }) => {
      const services = [
        serviceFixture(id, "Profissional incorreto", {
          title,
          subcategoryId: id,
          subcategoryName,
          categoryName: "Serviços Gerais",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (rankSemanticCandidates as jest.Mock).mockResolvedValue([
        { id, score: 0.34 },
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_SERVICO");
      expect(result.reply).toContain("Não encontrei serviços");
      expect(result.reply).toContain(query);
      expect(result.reply).not.toContain(title);
      expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
      expect(result.contextUpdate).toHaveProperty(
        "serviceChoicesData",
        undefined,
      );
      expect(rankSemanticCandidates).toHaveBeenCalledTimes(1);
    },
  );

  it("prioriza Montagem de Móveis ativa em vez da taxonomia vazia Montador de Móveis", async () => {
    const services = [
      serviceFixture(60, "Iago Silva", {
        title: "Montagem de Móveis",
        description: "Montagem e desmontagem de móveis residenciais",
        subcategoryId: 60,
        subcategoryName: "Marido de Aluguel",
        categoryName: "Reformas & Reparos",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(61, "Montador de Móveis", "Serviços Gerais"),
      subcategoryFixture(60, "Marido de Aluguel", "Reformas & Reparos"),
    ]);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 60, score: 0.36 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "Montador de Móveis",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Montagem de Móveis"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([60]);
    expect(result.reply).not.toMatch(/não.*serviços.*disponíveis/i);
  });

  it.each([
    {
      query: "tomada",
      id: 70,
      title: "Instalação de Tomadas",
      description: "Instalação e manutenção de tomadas elétricas",
      subcategoryName: "Eletricista",
    },
    {
      query: "faxina",
      id: 71,
      title: "Faxina Completa",
      description: "Limpeza completa de todos os cômodos",
      subcategoryName: "Diarista",
    },
    {
      query: "pia entupida",
      id: 72,
      title: "Desentupimento de Pia",
      description: "Desentupimento profissional de pias",
      subcategoryName: "Encanador",
    },
    {
      query: "torneira vazando",
      id: 73,
      title: "Conserto de Vazamentos",
      description: "Identificação e reparo de vazamentos em torneiras",
      subcategoryName: "Encanador",
    },
  ])(
    "preserva a correspondência textual de '$query' mesmo com ranking semântico fraco",
    async ({ query, id, title, description, subcategoryName }) => {
      const services = [
        serviceFixture(id, "Profissional correto", {
          title,
          description,
          subcategoryId: id,
          subcategoryName,
          categoryName: "Reformas & Reparos",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (rankSemanticCandidates as jest.Mock).mockResolvedValue([
        { id, score: 0.34 },
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain(`Vamos agendar "${title}"`);
      expect(result.contextUpdate.matchedServiceIds).toEqual([id]);
    },
  );

  it("mantém separados serviços homônimos de subcategorias distintas no resultado semântico", async () => {
    const services = [
      serviceFixture(100, "Ana", {
        title: "Consultoria Personalizada",
        description: "Orientação para projetos de decoração",
        subcategoryId: 100,
        subcategoryName: "Designer de Interiores",
        categoryName: "Reformas & Reparos",
      }),
      serviceFixture(102, "Bruno", {
        title: "Consultoria Personalizada",
        description: "Orientação para projetos de decoração",
        subcategoryId: 100,
        subcategoryName: "Designer de Interiores",
        categoryName: "Reformas & Reparos",
      }),
      serviceFixture(101, "Carla", {
        title: "Consultoria Personalizada",
        description: "Orientação para planejamento financeiro",
        subcategoryId: 101,
        subcategoryName: "Consultoria Financeira",
        categoryName: "Serviços Gerais",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 100, score: 0.72 },
      { id: 102, score: 0.7 },
      { id: 101, score: 0.3 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "preciso de apoio especializado",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(rankSemanticCandidates).toHaveBeenCalledTimes(1);
    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Consultoria Personalizada");
    expect(result.reply).not.toContain("Para qual dia");
    expect(result.reply).not.toContain("Consultoria Financeira");
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(result.contextUpdate.serviceChoicesData).toEqual([
      expect.objectContaining({
        title: "Consultoria Personalizada",
        subcategoryId: 100,
        subcategoryName: "Designer de Interiores",
        matchedServiceIds: [100, 102],
      }),
    ]);
  });

  it("pede seleção para o vencedor puramente semântico mesmo quando supera score e margem", async () => {
    const services = [
      serviceFixture(80, "Ana", {
        title: "Animação de Festa",
        description: "Recreação para celebrações infantis",
        subcategoryId: 80,
        subcategoryName: "Animador de Festa",
        categoryName: "Serviços Gerais",
      }),
      serviceFixture(81, "Bruno", {
        title: "Fotografia de Eventos",
        description: "Cobertura fotográfica de comemorações",
        subcategoryId: 81,
        subcategoryName: "Fotógrafo",
        categoryName: "Serviços Gerais",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 80, score: 0.6 },
      { id: 81, score: 0.49 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "preciso de apoio especializado",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(rankSemanticCandidates).toHaveBeenCalledTimes(1);
    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Animação de Festa");
    expect(result.reply).not.toContain("Para qual dia");
    expect(result.reply).not.toContain("Fotografia de Eventos");
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(result.contextUpdate.serviceChoicesData).toEqual([
      expect.objectContaining({
        title: "Animação de Festa",
        matchedServiceIds: [80],
      }),
    ]);
  });

  it("rejeita resultado puramente semântico abaixo de 0.60", async () => {
    const services = [
      serviceFixture(82, "Ana", {
        title: "Animação de Festa",
        subcategoryId: 82,
        subcategoryName: "Animador de Festa",
        categoryName: "Serviços Gerais",
      }),
      serviceFixture(83, "Bruno", {
        title: "Fotografia de Eventos",
        subcategoryId: 83,
        subcategoryName: "Fotógrafo",
        categoryName: "Serviços Gerais",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 82, score: 0.59 },
      { id: 83, score: 0.3 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "preciso de apoio especializado",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não encontrei serviços");
    expect(result.reply).not.toContain("Animação de Festa");
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
  });

  it("rejeita resultados puramente semânticos sem margem de 0.10 entre títulos distintos", async () => {
    const services = [
      serviceFixture(84, "Ana", {
        title: "Animação de Festa",
        subcategoryId: 84,
        subcategoryName: "Animador de Festa",
        categoryName: "Serviços Gerais",
      }),
      serviceFixture(85, "Bruno", {
        title: "Fotografia de Eventos",
        subcategoryId: 85,
        subcategoryName: "Fotógrafo",
        categoryName: "Serviços Gerais",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 84, score: 0.75 },
      { id: 85, score: 0.68 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "preciso de apoio especializado",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Não encontrei serviços");
    expect(result.reply).not.toContain("Animação de Festa");
    expect(result.reply).not.toContain("Fotografia de Eventos");
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
  });

  it("calcula a margem semântica entre títulos, agrupando profissionais do mesmo serviço", async () => {
    const services = [
      serviceFixture(86, "Ana", {
        title: "Animação de Festa",
        subcategoryId: 86,
        subcategoryName: "Animador de Festa",
        categoryName: "Serviços Gerais",
      }),
      serviceFixture(87, "Bruno", {
        title: "Animação de Festa",
        subcategoryId: 86,
        subcategoryName: "Animador de Festa",
        categoryName: "Serviços Gerais",
      }),
      serviceFixture(88, "Carla", {
        title: "Fotografia de Eventos",
        subcategoryId: 88,
        subcategoryName: "Fotógrafo",
        categoryName: "Serviços Gerais",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 86, score: 0.72 },
      { id: 87, score: 0.7 },
      { id: 88, score: 0.58 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "preciso de apoio especializado",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Animação de Festa");
    expect(result.reply).not.toContain("Para qual dia");
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    expect(result.contextUpdate.serviceChoicesData).toEqual([
      expect.objectContaining({
        title: "Animação de Festa",
        matchedServiceIds: [86, 87],
      }),
    ]);
  });

  it("continua listando resultados semânticos fortes quando há mais de um tipo relevante", async () => {
    const services = [
      serviceFixture(40, "Ana", {
        title: "Limpeza residencial",
        subcategoryId: 40,
      }),
      serviceFixture(41, "Bruno", {
        title: "Limpeza pós-obra",
        subcategoryId: 41,
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 40, score: 0.96 },
      { id: 41, score: 0.93 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "limpeza",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Limpeza residencial");
    expect(result.reply).toContain("Limpeza pós-obra");
    expect(result.contextUpdate.serviceChoicesData).toEqual([
      expect.objectContaining({
        title: "Limpeza residencial",
        matchedServiceIds: [40],
      }),
      expect.objectContaining({
        title: "Limpeza pós-obra",
        matchedServiceIds: [41],
      }),
    ]);
  });

  it("preserva a busca textual quando o serviço semântico está indisponível", async () => {
    const services = [serviceFixture(50, "Ana")];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockRejectedValue(
      new SemanticSearchUnavailableError(),
    );

    const result = await new ColetandoServicoState().handle(
      "Limpeza residencial",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Limpeza residencial"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([50]);
  });

  it.each([
    {
      query: "troca de pneu",
      id: 200,
      unrelatedTitle: "Troca de Disjuntores",
      subcategoryName: "Eletricista",
    },
    {
      query: "troca de óleo",
      id: 201,
      unrelatedTitle: "Troca de Disjuntores",
      subcategoryName: "Eletricista",
    },
    {
      query: "conserto de celular",
      id: 202,
      unrelatedTitle: "Conserto de Vazamentos",
      subcategoryName: "Encanador",
    },
    {
      query: "manutenção de computador",
      id: 203,
      unrelatedTitle: "Manutenção Preventiva",
      subcategoryName: "Eletricista",
    },
    {
      query: "instalação de internet",
      id: 204,
      unrelatedTitle: "Instalação de Tomadas",
      subcategoryName: "Eletricista",
    },
    {
      query: "limpeza de pele",
      id: 205,
      unrelatedTitle: "Limpeza Pesada",
      subcategoryName: "Diarista",
    },
  ])(
    "não agenda serviço alheio para a consulta inexistente '$query'",
    async ({ query, id, unrelatedTitle, subcategoryName }) => {
      const services = [
        serviceFixture(id, "Profissional alheio", {
          title: unrelatedTitle,
          subcategoryId: id,
          subcategoryName,
          categoryName: "Reformas & Reparos",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (rankSemanticCandidates as jest.Mock).mockResolvedValue([
        { id, score: 0.34 },
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_SERVICO");
      expect(result.reply).not.toContain(unrelatedTitle);
      expect(result.reply).not.toContain("Para qual dia");
      expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
      expect(result.contextUpdate).toHaveProperty(
        "serviceChoicesData",
        undefined,
      );
    },
  );

  it.each(["pia entupida", "pias entupidas"])(
    "agrupa ofertas no singular e plural para '%s'",
    async (query) => {
      const services = [
        serviceFixture(210, "Ana", {
          title: "Desentupimento de Pia",
          subcategoryId: 210,
          subcategoryName: "Encanador",
          categoryName: "Reformas & Reparos",
        }),
        serviceFixture(211, "Bruno", {
          title: "Desentupimento de Pias",
          subcategoryId: 210,
          subcategoryName: "Encanador",
          categoryName: "Reformas & Reparos",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (rankSemanticCandidates as jest.Mock).mockResolvedValue([
        { id: 210, score: 0.34 },
        { id: 211, score: 0.33 },
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain("Desentupimento de Pia");
      expect(result.contextUpdate.matchedServiceIds).toEqual([210, 211]);
    },
  );

  it("lista tomada comum e inteligente quando a consulta é genérica", async () => {
    const services = [
      serviceFixture(220, "Ana", {
        title: "Instalação de Tomadas",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
        categoryName: "Reformas & Reparos",
      }),
      serviceFixture(221, "Bruno", {
        title: "Instalação de Tomada Inteligente",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
        categoryName: "Reformas & Reparos",
      }),
      serviceFixture(222, "Carla", {
        title: "Instalação de Tomada Inteligente",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
        categoryName: "Reformas & Reparos",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);

    const result = await new ColetandoServicoState().handle(
      "tomada",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Instalação de Tomadas");
    expect(result.reply).toContain("Instalação de Tomada Inteligente");
    expect(result.contextUpdate.serviceChoicesData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Instalação de Tomadas",
          matchedServiceIds: [220],
        }),
        expect.objectContaining({
          title: "Instalação de Tomada Inteligente",
          matchedServiceIds: [221, 222],
        }),
      ]),
    );
  });

  it("restringe tomada inteligente às ofertas correspondentes", async () => {
    const services = [
      serviceFixture(220, "Ana", {
        title: "Instalação de Tomadas",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
      }),
      serviceFixture(221, "Bruno", {
        title: "Instalação de Tomada Inteligente",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
      }),
      serviceFixture(222, "Carla", {
        title: "Instalação de Tomada Inteligente",
        subcategoryId: 220,
        subcategoryName: "Eletricista",
      }),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);

    const result = await new ColetandoServicoState().handle(
      "tomada inteligente",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.contextUpdate.serviceName).toBe(
      "Instalação de Tomada Inteligente",
    );
    expect(result.contextUpdate.matchedServiceIds).toEqual([221, 222]);
    expect(result.contextUpdate.matchedServiceIds).not.toContain(220);
  });

  it.each([
    "desentupidor",
    "preciso de desentupidor",
    "alguém para desentupir",
  ])(
    "encontra ofertas de encanador para a ocupação '%s' antes da taxonomia vazia",
    async (query) => {
      const services = [
        serviceFixture(230, "Ana", {
          title: "Desentupimento de Pia",
          subcategoryId: 230,
          subcategoryName: "Encanador",
        }),
        serviceFixture(231, "Bruno", {
          title: "Desentupimento de Pias",
          subcategoryId: 230,
          subcategoryName: "Encanador",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
        subcategoryFixture(232, "Desentupidor", "Serviços Gerais"),
        subcategoryFixture(230, "Encanador", "Reformas & Reparos"),
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain("Desentupimento de Pia");
      expect(result.contextUpdate.matchedServiceIds).toEqual([230, 231]);
      expect(result.reply).not.toMatch(/não.*serviços.*disponíveis/i);
    },
  );

  it.each(["desentupir celular", "desentupir ouvido"])(
    "não transforma o objeto desconhecido em serviço de pia: '%s'",
    async (query) => {
      (ServiceModel.findAll as jest.Mock).mockResolvedValue([
        serviceFixture(233, "Ana", {
          title: "Desentupimento de Pia",
          subcategoryId: 233,
          subcategoryName: "Encanador",
        }),
      ]);
      (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
        subcategoryFixture(234, "Desentupidor", "Serviços Gerais"),
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_SERVICO");
      expect(result.serviceSearchOutcome).toBe("NOT_FOUND");
      expect(result.reply).not.toContain(
        'Vamos agendar "Desentupimento de Pia"',
      );
      expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
    },
  );

  it.each([
    {
      query: "montar guarda roupa",
      id: 240,
      title: "Montagem de Móveis",
      subcategoryName: "Marido de Aluguel",
    },
    {
      query: "abrir porta trancada",
      id: 243,
      title: "Abertura de Fechaduras",
      subcategoryName: "Chaveiro",
    },
    {
      query: "chave presa",
      id: 244,
      title: "Abertura de Fechaduras",
      subcategoryName: "Chaveiro",
    },
    {
      query: "limpar vidraça",
      id: 245,
      title: "Limpeza de Vidros",
      subcategoryName: "Vidraceiro",
    },
    {
      query: "chaverio",
      id: 247,
      title: "Abertura de Fechaduras",
      subcategoryName: "Chaveiro",
    },
  ])(
    "reconhece o alias ou erro simples '$query' como '$title'",
    async ({ query, id, title, subcategoryName }) => {
      const services = [
        serviceFixture(id, "Profissional", {
          title,
          subcategoryId: id,
          subcategoryName,
          categoryName: "Serviços Gerais",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
      (rankSemanticCandidates as jest.Mock).mockResolvedValue([
        { id, score: 0.34 },
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain(`Vamos agendar "${title}"`);
      expect(result.contextUpdate.matchedServiceIds).toEqual([id]);
    },
  );

  it.each([
    {
      query: "faxineira",
      firstId: 251,
      firstTitle: "Faxina Completa",
      secondTitle: "Limpeza Pesada",
      subcategoryName: "Diarista",
    },
    {
      query: "cortar grama",
      firstId: 253,
      firstTitle: "Manutenção de Jardim",
      secondTitle: "Paisagismo",
      subcategoryName: "Jardineiro",
    },
    {
      query: "jardineio",
      firstId: 255,
      firstTitle: "Manutenção de Jardim",
      secondTitle: "Paisagismo",
      subcategoryName: "Jardineiro",
    },
  ])(
    "lista todas as ofertas reais relacionadas ao alias '$query'",
    async ({ query, firstId, firstTitle, secondTitle, subcategoryName }) => {
      const services = [
        serviceFixture(firstId, "Profissional A", {
          title: firstTitle,
          subcategoryId: firstId,
          subcategoryName,
          categoryName: "Serviços Domésticos",
        }),
        serviceFixture(firstId + 1, "Profissional B", {
          title: secondTitle,
          subcategoryId: firstId,
          subcategoryName,
          categoryName: "Serviços Domésticos",
        }),
      ];
      (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_SERVICO");
      expect(result.reply).toContain(firstTitle);
      expect(result.reply).toContain(secondTitle);
      expect(result.contextUpdate.serviceChoicesData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: firstTitle,
            matchedServiceIds: [firstId],
          }),
          expect.objectContaining({
            title: secondTitle,
            matchedServiceIds: [firstId + 1],
          }),
        ]),
      );
    },
  );

  it("prefere Pedicure Completa ativa à taxonomia vazia equivalente", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(260, "Profissional A", {
        title: "Pedicure Completa",
        subcategoryId: 260,
        subcategoryName: "Manicure",
        categoryName: "Beleza & Estética",
      }),
    ]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(261, "Manicure & Pedicure", "Beleza & Estética"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "pedicure",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Pedicure Completa"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([260]);
  });

  it("lista manicure e pedicure ativas quando a taxonomia conjunta está vazia", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(262, "Profissional A", {
        title: "Manicure Completa",
        subcategoryId: 262,
        subcategoryName: "Manicure",
        categoryName: "Beleza & Estética",
      }),
      serviceFixture(263, "Profissional B", {
        title: "Pedicure Completa",
        subcategoryId: 262,
        subcategoryName: "Manicure",
        categoryName: "Beleza & Estética",
      }),
    ]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(264, "Manicure & Pedicure", "Beleza & Estética"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "manicure e pedicure",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Manicure Completa");
    expect(result.reply).toContain("Pedicure Completa");
    expect(result.contextUpdate.serviceChoicesData).toHaveLength(2);
  });

  it("reconhece pintura como a taxonomia Pintor sem oferta", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(250, "Pintor", "Reformas & Reparos"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "pintura",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.reply).toContain("Pintor");
    expect(result.reply).toMatch(/não.*serviços.*disponíveis/i);
    expect(result.contextUpdate).toHaveProperty(
      "serviceChoicesData",
      undefined,
    );
    expect(rankSemanticCandidates).not.toHaveBeenCalled();
  });

  it.each(["preciso de montador", "quero montador", "preciso de montagem"])(
    "prioriza a oferta ativa para a ocupação isolada: '%s'",
    async (query) => {
      (ServiceModel.findAll as jest.Mock).mockResolvedValue([
        serviceFixture(94, "Iago", {
          title: "Montagem de Móveis",
          subcategoryId: 94,
          subcategoryName: "Marido de Aluguel",
          categoryName: "Reformas & Reparos",
        }),
      ]);
      (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
        subcategoryFixture(95, "Montador de Móveis", "Reformas & Reparos"),
      ]);

      const result = await new ColetandoServicoState().handle(
        query,
        { intent: "FALLBACK", entities: {}, confidence: 0.8 },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain('Vamos agendar "Montagem de Móveis"');
      expect(result.contextUpdate.matchedServiceIds).toEqual([94]);
    },
  );

  it("não confunde montador de eventos com montagem de móveis", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(96, "Iago", {
        title: "Montagem de Móveis",
        subcategoryId: 96,
        subcategoryName: "Marido de Aluguel",
        categoryName: "Reformas & Reparos",
      }),
    ]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(97, "Montador de Móveis", "Reformas & Reparos"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "montador de eventos",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_SERVICO");
    expect(result.serviceSearchOutcome).toBe("NOT_FOUND");
    expect(result.reply).not.toContain('Vamos agendar "Montagem de Móveis"');
    expect(result.contextUpdate.matchedServiceIds).toBeUndefined();
  });

  it("reconhece o termo da subcategoria 'Chaveiro' ao responder uma escolha pendente", async () => {
    const choices: BotServiceChoice[] = [
      {
        title: "Abertura de Fechaduras",
        description: "Serviço de chaveiro para residência e automóvel",
        subcategoryId: 301,
        subcategoryName: "Chaveiro",
        categoryName: "Reformas & Reparos",
        matchedServiceIds: [301],
      },
    ];

    const result = await new ColetandoServicoState().handle(
      "chaveiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: {
          pendingAction: "CREATE",
          serviceChoicesData: choices,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Abertura de Fechaduras"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([301]);
  });

  it("reconhece a subcategoria 'Chaveiro' diretamente na busca de serviço", async () => {
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(302, "Marcos Chaveiro", {
        title: "Abertura de Fechaduras",
        subcategoryId: 302,
        subcategoryName: "Chaveiro",
        categoryName: "Reformas & Reparos",
      }),
    ]);
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      subcategoryFixture(302, "Chaveiro", "Reformas & Reparos"),
    ]);

    const result = await new ColetandoServicoState().handle(
      "chaveiro",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.reply).toContain('Vamos agendar "Abertura de Fechaduras"');
    expect(result.contextUpdate.matchedServiceIds).toEqual([302]);
  });

  it.each([
    "gostaria de marcar um chaveiro por favor",
    "eu quero agendar um chaveiro por favor",
    "preciso chamar um chaveiro",
  ])(
    "reconhece a subcategoria 'Chaveiro' em frases completas com verbos de ação e polidez: '%s'",
    async (userSentence) => {
      (ServiceModel.findAll as jest.Mock).mockResolvedValue([
        serviceFixture(303, "Marcos Chaveiro", {
          title: "Abertura de Fechaduras",
          subcategoryId: 303,
          subcategoryName: "Chaveiro",
          categoryName: "Reformas & Reparos",
        }),
      ]);
      (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
        subcategoryFixture(303, "Chaveiro", "Reformas & Reparos"),
      ]);

      const result = await new ColetandoServicoState().handle(
        userSentence,
        {
          intent: "AGENDAR",
          entities: { service: "chaveiro" },
          confidence: 1,
        },
        { context: { pendingAction: "CREATE" } } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("COLETANDO_DATA");
      expect(result.reply).toContain('Vamos agendar "Abertura de Fechaduras"');
      expect(result.contextUpdate.matchedServiceIds).toEqual([303]);
    },
  );
});



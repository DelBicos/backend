import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Service");
jest.mock("../../../models/ServiceAvailability");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Subcategory");
jest.mock("../../../models/User");
jest.mock("../../../models/Address");
jest.mock("../../../models/Category");
jest.mock("../../../utils/sse", () => ({ emitSSE: jest.fn() }));
jest.mock("../../semanticSearch.service", () => {
  class SemanticSearchUnavailableError extends Error {}
  return {
    rankSemanticCandidates: jest.fn(),
    SEMANTIC_SEARCH_RESULT_LIMIT: 200,
    SemanticSearchUnavailableError,
  };
});

import { sequelize } from "../../../config/database";
import { ServiceModel } from "../../../models/Service";
import { ServiceAvailabilityModel } from "../../../models/ServiceAvailability";
import { ProfessionalModel } from "../../../models/Professional";
import { SubCategoryModel } from "../../../models/Subcategory";
import { emitSSE } from "../../../utils/sse";
import * as semantic from "../../semanticSearch.service";
import * as catalog from "../catalog.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const serviceRow = (overrides: Record<string, unknown> = {}) => {
  const data = {
    id: 5,
    title: "Limpeza",
    price: 100,
    professional_id: 20,
    subcategory_id: 3,
    Availabilities: [{ id: 1, day_of_week: 1, start_time: "09:00:00", end_time: "12:00:00" }],
    ...overrides,
  };
  return {
    ...data,
    update: jest.fn(),
    save: jest.fn(),
    toJSON: () => ({ ...data }),
  } as any;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Executa o callback da transacao sem abrir conexao real.
  jest
    .spyOn(sequelize, "transaction")
    .mockImplementation(async (cb: any) => cb({ id: "tx" }) as any);
});

describe("leitura publica", () => {
  it("getPublicById normaliza horarios e retorna 404 se nao existir", async () => {
    mocked(ServiceModel.findByPk).mockResolvedValueOnce(serviceRow());
    const json: any = await catalog.getPublicById("5");
    expect(json.Availabilities[0].start_time).toBe("09:00");

    mocked(ServiceModel.findByPk).mockResolvedValueOnce(null);
    await expectHttpError(catalog.getPublicById("5"), 404);
  });

  it("nao expoe e-mail do profissional nos includes publicos", async () => {
    mocked(ServiceModel.findByPk).mockResolvedValueOnce(serviceRow());
    await catalog.getPublicById("5");
    const include = mocked(ServiceModel.findByPk).mock.calls[0][1].include;
    const professional = include.find((i: any) => i.as === "Professional");
    const user = professional.include.find((i: any) => i.as === "User");
    expect(user.attributes).not.toContain("email");
  });

  it("listPublic aplica filtros e pagina", async () => {
    mocked(ServiceModel.findAndCountAll).mockResolvedValue({ count: 1, rows: [serviceRow()] });
    const result = await catalog.listPublic({ subcategory_id: "3", q: " lim ", day: "1", page: "2", limit: "10" });
    const args = mocked(ServiceModel.findAndCountAll).mock.calls[0][0];
    expect(args.where.subcategory_id).toBe(3);
    expect(args.offset).toBe(10);
    expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
  });
});

describe("searchSemantic", () => {
  it("valida o tamanho da consulta", async () => {
    await expectHttpError(catalog.searchSemantic({ q: "a" }), 400);
  });

  it("valida o dia da semana", async () => {
    await expectHttpError(catalog.searchSemantic({ q: "pintura", day: "9" }), 400);
  });

  it("retorna vazio sem consultar o nlp-service quando nao ha candidatos", async () => {
    mocked(ServiceModel.findAll).mockResolvedValueOnce([]);
    const result = await catalog.searchSemantic({ q: "pintura" });
    expect(result.data).toEqual([]);
    expect(semantic.rankSemanticCandidates).not.toHaveBeenCalled();
  });

  it("devolve 503 quando o nlp-service esta indisponivel", async () => {
    mocked(ServiceModel.findAll).mockResolvedValueOnce([serviceRow()]);
    mocked(semantic.rankSemanticCandidates).mockRejectedValueOnce(
      new semantic.SemanticSearchUnavailableError("off"),
    );
    await expectHttpError(catalog.searchSemantic({ q: "pintura" }), 503);
  });

  it("ordena pelos hits e inclui o score", async () => {
    mocked(ServiceModel.findAll)
      .mockResolvedValueOnce([serviceRow({ id: 1 }), serviceRow({ id: 2 })])
      .mockResolvedValueOnce([serviceRow({ id: 1 }), serviceRow({ id: 2 })]);
    mocked(semantic.rankSemanticCandidates).mockResolvedValueOnce([
      { id: 2, score: 0.9 },
      { id: 1, score: 0.5 },
    ]);

    const result: any = await catalog.searchSemantic({ q: "pintura", limit: "1" });

    expect(result.total).toBe(2);
    expect(result.has_more).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 2, relevance_score: 0.9 });
  });
});

describe("createForUser", () => {
  const input = {
    title: "  Pintura  ",
    description: "Parede",
    price: "150.5",
    category_id: 1,
    subcategory_id: 3,
    availabilities: [{ day: 1, start: "09:00", end: "12:00" }],
  };

  const arrange = (professionalId: number) => {
    mocked(ProfessionalModel.findOne).mockResolvedValue({ id: professionalId, user_id: 9 });
    mocked(SubCategoryModel.findByPk).mockResolvedValue({ id: 3, category_id: 1 });
    mocked(ServiceModel.create).mockResolvedValue({ id: 5 });
    mocked(ServiceModel.findByPk).mockResolvedValue(serviceRow());
  };

  it("exige perfil profissional", async () => {
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    await expectHttpError(catalog.createForUser(9, input), 403);
  });

  it("rejeita subcategoria de outra categoria", async () => {
    arrange(101);
    mocked(SubCategoryModel.findByPk).mockResolvedValue({ id: 3, category_id: 2 });
    await expectHttpError(catalog.createForUser(9, input), 400);
  });

  it("rota legada nao permite criar para outro profissional", async () => {
    arrange(102);
    await expectHttpError(catalog.createForUser(9, input, { professionalId: "999" }), 403);
  });

  it("cria servico e disponibilidade na mesma transacao e emite SSE", async () => {
    arrange(103);
    const result: any = await catalog.createForUser(9, input);

    const created = mocked(ServiceModel.create).mock.calls[0];
    expect(created[0]).toMatchObject({
      title: "Pintura",
      price: 150.5,
      price_cents: 15050,
      professional_id: 103,
      category_id: 1,
    });
    expect(created[1]).toEqual({ transaction: { id: "tx" } });
    expect(mocked(ServiceAvailabilityModel.bulkCreate).mock.calls[0][1]).toEqual({
      transaction: { id: "tx" },
    });
    expect(emitSSE).toHaveBeenCalledWith("services", "new_service", expect.any(Object));
    expect(result.id).toBe(5);
  });

  it("bloqueia criacao duplicada em sequencia (429)", async () => {
    arrange(104);
    await catalog.createForUser(9, input);
    await expectHttpError(catalog.createForUser(9, input), 429);
  });
});

describe("updateForUser / deactivateForUser", () => {
  it("impede alterar servico de outro profissional", async () => {
    mocked(ServiceModel.findByPk).mockResolvedValue(serviceRow());
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 999 });
    await expectHttpError(catalog.updateForUser(9, "5", { title: "x" }), 403);
  });

  it("atualiza campos permitidos, sincroniza preco e substitui disponibilidade", async () => {
    const service = serviceRow();
    mocked(ServiceModel.findByPk).mockResolvedValue(service);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 9 });

    await catalog.updateForUser(9, "5", {
      title: "Novo",
      price_cents: 2000,
      professional_id: 1,
      availabilities: [],
    } as any);

    expect(service.update).toHaveBeenCalledWith(
      { title: "Novo", price: 20, price_cents: 2000 },
      { transaction: { id: "tx" } },
    );
    expect(ServiceAvailabilityModel.destroy).toHaveBeenCalled();
    expect(ServiceAvailabilityModel.bulkCreate).not.toHaveBeenCalled();
  });

  it("valida a subcategoria contra a categoria ao trocar so a categoria", async () => {
    mocked(ServiceModel.findByPk).mockResolvedValue(serviceRow());
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 9 });
    mocked(SubCategoryModel.findByPk).mockResolvedValue({ id: 3, category_id: 1 });
    await expectHttpError(catalog.updateForUser(9, "5", { category_id: 2 }), 400);
  });

  it("desativa (soft delete) o proprio servico", async () => {
    const service = serviceRow({ active: true });
    mocked(ServiceModel.findByPk).mockResolvedValue(service);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 9 });

    await catalog.deactivateForUser(9, "5");

    expect(service.active).toBe(false);
    expect(service.save).toHaveBeenCalled();
  });
});

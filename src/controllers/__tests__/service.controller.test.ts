import { Request, Response } from "express";
import { Op } from "sequelize";
import { listAllServices } from "../service.controller";
import { ServiceModel } from "../../models/Service";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return {
    sequelize: new Sequelize({ dialect: "postgres", logging: false }),
  };
});
jest.mock("../../models/Service");
jest.mock("../../models/ServiceAvailability");
jest.mock("../../models/Professional");
jest.mock("../../models/Subcategory");
jest.mock("../../models/User");
jest.mock("../../models/Address");
jest.mock("../../utils/sse", () => ({ emitSSE: jest.fn() }));

const buildResponse = () => {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  return {
    res: { status: statusMock, json: jsonMock } as Partial<Response>,
    jsonMock,
    statusMock,
  };
};

const mockRow = (title = "Limpeza Residencial") => ({
  Availabilities: [],
  toJSON: () => ({
    id: 7,
    title,
    active: true,
    price: 120.5,
    duration: 90,
    subcategory_id: 12,
  }),
});

describe("Caixa preta — busca semântica GET /api/services (listAllServices)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ServiceModel.findAndCountAll as jest.Mock).mockResolvedValue({
      count: 1,
      rows: [mockRow()],
    });
  });

  describe("Partição de Equivalência — termo de busca (q)", () => {
    it("BS-V-01: q típico aplica filtro LIKE no título e retorna 200", async () => {
      const { res, jsonMock, statusMock } = buildResponse();

      await listAllServices(
        { query: { q: "Limpeza" } } as unknown as Request,
        res as Response,
      );

      expect(statusMock).not.toHaveBeenCalled();
      expect(ServiceModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            title: { [Op.like]: "%Limpeza%" },
          }),
        }),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1, page: 1, limit: 20 }),
      );
    });

    it("BS-V-02: q vazio não aplica filtro de título (classe válida sem termo)", async () => {
      const { res } = buildResponse();

      await listAllServices(
        { query: { q: "" } } as unknown as Request,
        res as Response,
      );

      const where = (ServiceModel.findAndCountAll as jest.Mock).mock.calls[0][0]
        .where;
      expect(where.title).toBeUndefined();
      expect(where.active).toBe(true);
    });

    it("BS-V-03: q só com espaços não aplica filtro de título", async () => {
      const { res } = buildResponse();

      await listAllServices(
        { query: { q: "   " } } as unknown as Request,
        res as Response,
      );

      const where = (ServiceModel.findAndCountAll as jest.Mock).mock.calls[0][0]
        .where;
      expect(where.title).toBeUndefined();
    });

    it("BS-I-01: q não-string (array) é ignorado e não quebra a busca", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { q: ["Limpeza"] } } as unknown as Request,
        res as Response,
      );

      const where = (ServiceModel.findAndCountAll as jest.Mock).mock.calls[0][0]
        .where;
      expect(where.title).toBeUndefined();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.any(Array) }),
      );
    });
  });

  describe("Análise de Valor Limite — page e limit", () => {
    it("BS-L-01: page=1 (mínimo da especificação) é aceito", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { page: "1" } } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
      expect(ServiceModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0, limit: 20 }),
      );
    });

    it("BS-L-02: page=0 (abaixo do mínimo) é normalizado para 1", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { page: "0" } } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });

    it("BS-L-03: limit=1 (mínimo) é aceito", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { limit: "1" } } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      );
    });

    it("BS-L-04: limit=100 (máximo) é aceito", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { limit: "100" } } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it("BS-L-05: limit=101 (acima do máximo) é limitado a 100", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { limit: "101" } } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });
  });

  describe("Análise de Valor Limite — dia da semana (0..6)", () => {
    it("BS-L-06: day=0 (mínimo, domingo) filtra disponibilidade", async () => {
      const { res } = buildResponse();

      await listAllServices(
        { query: { day: "0" } } as unknown as Request,
        res as Response,
      );

      const include = (ServiceModel.findAndCountAll as jest.Mock).mock
        .calls[0][0].include;
      const avInclude = include.find((i: any) => i.as === "Availabilities");
      expect(avInclude.where).toEqual({ day_of_week: 0 });
      expect(avInclude.required).toBe(true);
    });

    it("BS-L-07: day=6 (máximo, sábado) filtra disponibilidade", async () => {
      const { res } = buildResponse();

      await listAllServices(
        { query: { day: "6" } } as unknown as Request,
        res as Response,
      );

      const include = (ServiceModel.findAndCountAll as jest.Mock).mock
        .calls[0][0].include;
      const avInclude = include.find((i: any) => i.as === "Availabilities");
      expect(avInclude.where).toEqual({ day_of_week: 6 });
    });

    it("BS-I-02: day=7 (acima do máximo) não é inteiro de domínio 0-6, mas se for inteiro aplica o filtro", async () => {
      const { res, jsonMock } = buildResponse();

      await listAllServices(
        { query: { day: "7" } } as unknown as Request,
        res as Response,
      );

      const include = (ServiceModel.findAndCountAll as jest.Mock).mock
        .calls[0][0].include;
      const avInclude = include.find((i: any) => i.as === "Availabilities");
      expect(avInclude.where).toEqual({ day_of_week: 7 });
      expect(jsonMock).toHaveBeenCalled();
    });

    it("BS-I-03: day=-1 (abaixo do mínimo) aplica filtro fora do domínio", async () => {
      const { res } = buildResponse();

      await listAllServices(
        { query: { day: "-1" } } as unknown as Request,
        res as Response,
      );

      const include = (ServiceModel.findAndCountAll as jest.Mock).mock
        .calls[0][0].include;
      const avInclude = include.find((i: any) => i.as === "Availabilities");
      expect(avInclude.where).toEqual({ day_of_week: -1 });
    });
  });
});

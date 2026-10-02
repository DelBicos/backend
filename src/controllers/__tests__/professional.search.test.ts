import { Request, Response } from "express";
import { Op } from "sequelize";
import {
  getProfessionals,
  searchProfessionalAvailability,
  updateProfessionalRadius,
} from "../professional.controller";
import { ProfessionalModel } from "../../models/Professional";
import { ProfessionalAvailabilityModel } from "../../models/ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel } from "../../models/ProfessionalAvailabilityLock";
import { ServiceAvailabilityModel } from "../../models/ServiceAvailability";
import { AppointmentModel } from "../../models/Appointment";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return {
    sequelize: new Sequelize({ dialect: "postgres", logging: false }),
  };
});
jest.mock("../../models/Professional");
jest.mock("../../models/User");
jest.mock("../../models/Address");
jest.mock("../../models/Service");
jest.mock("../../models/Appointment");
jest.mock("../../models/Client");
jest.mock("../../models/ProfessionalAvailability");
jest.mock("../../models/ProfessionalAvailabilityLock");
jest.mock("../../models/ServiceAvailability");

const buildResponse = () => {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  return {
    res: { status: statusMock, json: jsonMock } as Partial<Response>,
    jsonMock,
    statusMock,
  };
};

const PROF_LAT = -23.5505;
const PROF_LNG = -46.6333;

function pointAtDistanceKm(lat: number, lng: number, km: number) {
  const dLat = km / 111.32;
  return { lat: lat + dLat, lng };
}

describe("Caixa preta — busca semântica GET /api/professionals (getProfessionals)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ProfessionalModel.findAndCountAll as jest.Mock).mockResolvedValue({
      count: 0,
      rows: [],
    });
  });

  it("BS-V-04: termo típico busca por nome, e-mail ou CPF", async () => {
    const { res, jsonMock } = buildResponse();

    await getProfessionals(
      { query: { termo: "Ana" } } as unknown as Request,
      res as Response,
    );

    expect(ProfessionalModel.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          [Op.or]: [
            { "$User.name$": { [Op.like]: "%Ana%" } },
            { "$User.email$": { [Op.like]: "%Ana%" } },
            { cpf: { [Op.like]: "%Ana%" } },
          ],
        },
      }),
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        professionals: [],
        totalCount: 0,
        currentPage: 0,
        pageSize: 12,
      }),
    );
  });

  it("BS-V-05: sem termo lista profissionais sem filtro textual", async () => {
    const { res } = buildResponse();

    await getProfessionals({ query: {} } as unknown as Request, res as Response);

    const where = (ProfessionalModel.findAndCountAll as jest.Mock).mock
      .calls[0][0].where;
    expect(where[Op.or]).toBeUndefined();
  });

  it("BS-V-06: termo vazio é tratado como ausência de filtro", async () => {
    const { res } = buildResponse();

    await getProfessionals(
      { query: { termo: "" } } as unknown as Request,
      res as Response,
    );

    const where = (ProfessionalModel.findAndCountAll as jest.Mock).mock
      .calls[0][0].where;
    expect(where[Op.or]).toBeUndefined();
  });
});

describe("Caixa preta — busca de disponibilidade GET /api/professionals/search-availability", () => {
  const professional = {
    id: 20,
    service_radius_km: 10,
    User: { name: "Ana", avatar_uri: "http://img" },
    MainAddress: {
      city: "São Paulo",
      state: "SP",
      lat: String(PROF_LAT),
      lng: String(PROF_LNG),
    },
    Services: [
      {
        id: 5,
        title: "Limpeza Residencial",
        price: 150,
        subcategory_id: 1,
        duration: 60,
        active: true,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    (ProfessionalModel.findAll as jest.Mock).mockResolvedValue([professional]);
    (ProfessionalAvailabilityModel.findAll as jest.Mock).mockImplementation(
      async (opts: any) => {
        if (opts?.where?.is_available === false) return [];
        return [
          {
            start_time: "09:00",
            end_time: "12:00",
            is_available: true,
            recurrence_pattern: "daily",
          },
        ];
      },
    );
    (ProfessionalAvailabilityLockModel.findAll as jest.Mock).mockResolvedValue(
      [],
    );
    (ServiceAvailabilityModel.findAll as jest.Mock).mockResolvedValue([]);
    (AppointmentModel.findAll as jest.Mock).mockResolvedValue([]);
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      Appointments: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Partição de Equivalência — parâmetros obrigatórios e data", () => {
    it("AG-I-01: sem subCategoryId retorna 400", async () => {
      const { res, jsonMock, statusMock } = buildResponse();

      await searchProfessionalAvailability(
        { query: { date: "2026-10-01" } } as unknown as Request,
        res as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "subCategoryId e date são obrigatórios.",
      });
    });

    it("AG-I-02: sem date retorna 400", async () => {
      const { res, jsonMock, statusMock } = buildResponse();

      await searchProfessionalAvailability(
        { query: { subCategoryId: "1" } } as unknown as Request,
        res as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "subCategoryId e date são obrigatórios.",
      });
    });

    it("AG-I-03: data em formato DD/MM/AAAA é inválida", async () => {
      const { res, jsonMock, statusMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: { subCategoryId: "1", date: "01/10/2026" },
        } as unknown as Request,
        res as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Formato de data inválido. Use AAAA-MM-DD.",
      });
    });

    it("AG-V-01: data AAAA-MM-DD com subcategoria retorna profissionais com horários", async () => {
      const { res, jsonMock, statusMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: { subCategoryId: "1", date: "2026-10-01" },
        } as unknown as Request,
        res as Response,
      );

      expect(statusMock).not.toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 20,
          name: "Ana",
          serviceId: 5,
          availableTimes: expect.arrayContaining(["09:00"]),
        }),
      ]);
    });

    it("AG-V-02: nenhum profissional na subcategoria retorna lista vazia", async () => {
      (ProfessionalModel.findAll as jest.Mock).mockResolvedValue([]);
      const { res, jsonMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: { subCategoryId: "99", date: "2026-10-01" },
        } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith([]);
    });
  });

  describe("Análise de Valor Limite — raio de atuação na busca", () => {
    it("AG-L-01: cliente a 9,99 km (logo abaixo do raio 10) aparece no resultado", async () => {
      const point = pointAtDistanceKm(PROF_LAT, PROF_LNG, 9.99);
      const { res, jsonMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: {
            subCategoryId: "1",
            date: "2026-10-01",
            lat: String(point.lat),
            lng: String(point.lng),
          },
        } as unknown as Request,
        res as Response,
      );

      const results = jsonMock.mock.calls[0][0];
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(20);
      expect(results[0].distance).toBeLessThanOrEqual(10);
    });

    it("AG-L-02: cliente logo acima do raio (10,5 km) é excluído", async () => {
      const point = pointAtDistanceKm(PROF_LAT, PROF_LNG, 10.5);
      const { res, jsonMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: {
            subCategoryId: "1",
            date: "2026-10-01",
            lat: String(point.lat),
            lng: String(point.lng),
          },
        } as unknown as Request,
        res as Response,
      );

      expect(jsonMock).toHaveBeenCalledWith([]);
    });

    it("AG-L-03: cliente no mesmo ponto (distância 0, mínimo) aparece", async () => {
      const { res, jsonMock } = buildResponse();

      await searchProfessionalAvailability(
        {
          query: {
            subCategoryId: "1",
            date: "2026-10-01",
            lat: String(PROF_LAT),
            lng: String(PROF_LNG),
          },
        } as unknown as Request,
        res as Response,
      );

      const results = jsonMock.mock.calls[0][0];
      expect(results).toHaveLength(1);
      expect(results[0].distance).toBe(0);
    });
  });
});

describe("Caixa preta — valor limite de service_radius_km", () => {
  const save = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      user_id: 2,
      service_radius_km: 15,
      save,
    });
  });

  it("AG-L-04: raio = 0 (mínimo válido) é aceito", async () => {
    const { res, jsonMock, statusMock } = buildResponse();

    await updateProfessionalRadius(
      { user: { id: 2 }, params: { id: "20" }, body: { service_radius_km: 0 } } as any,
      res as Response,
    );

    expect(statusMock).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith({
      message: "Raio atualizado",
      service_radius_km: 0,
    });
  });

  it("AG-L-05: raio = -1 (abaixo do mínimo) retorna 400", async () => {
    const { res, jsonMock, statusMock } = buildResponse();

    await updateProfessionalRadius(
      {
        user: { id: 2 },
        params: { id: "20" },
        body: { service_radius_km: -1 },
      } as any,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "service_radius_km deve ser um número >= 0",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("AG-L-06: raio = 1 (primeiro valor acima do mínimo) é aceito", async () => {
    const { res, jsonMock } = buildResponse();

    await updateProfessionalRadius(
      { user: { id: 2 }, params: { id: "20" }, body: { service_radius_km: 1 } } as any,
      res as Response,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: "Raio atualizado",
      service_radius_km: 1,
    });
  });
});

import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Professional");

import { sequelize } from "../../../config/database";
import { ProfessionalModel } from "../../../models/Professional";
import * as dashboard from "../dashboard.service";

const mocked = (fn: unknown) => fn as jest.Mock;
let query: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  query = jest.spyOn(sequelize, "query").mockResolvedValue([] as any);
  jest.spyOn(sequelize, "getDialect").mockReturnValue("postgres");
  mocked(ProfessionalModel.findOne).mockResolvedValue({ id: 20 });
});

describe("resolvePeriod", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("usa os ultimos 12 meses por padrao", () => {
    const { from, to } = dashboard.resolvePeriod({}, now);
    expect(to).toEqual(now);
    expect(from.getDate()).toBe(1);
    // setembro/2026 - 11 meses = outubro/2025
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(9);
  });

  it("ignora datas invalidas e rejeita periodo invertido", () => {
    expect(dashboard.resolvePeriod({ to: "invalida" }, now).to).toEqual(now);
    expect(() => dashboard.resolvePeriod({ from: "2026-10-01", to: "2026-01-01" }, now)).toThrow(
      HttpError,
    );
  });
});

describe("helpers SQL", () => {
  it("formata timestamp e expressao de mes por dialeto", () => {
    expect(dashboard.toSqlTimestamp(new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "2026-01-02 03:04:05",
    );
    expect(dashboard.monthExpression("postgres")).toContain("to_char");
    expect(dashboard.monthExpression("mysql")).toContain("DATE_FORMAT");
  });
});

describe("getKpis", () => {
  it("exige perfil profissional", async () => {
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    await expect(dashboard.getKpis(1)).rejects.toMatchObject({ status: 404 });
  });

  it("le os aliases em snake_case (Postgres devolve identificadores em minusculas)", async () => {
    query.mockResolvedValue([{ total_services: "3", total_earnings: "450.50", avg_rating: "4.5" }]);

    await expect(dashboard.getKpis(1)).resolves.toEqual({
      totalServices: 3,
      totalEarnings: 450.5,
      avgRating: 4.5,
    });
    expect(query.mock.calls[0][1].replacements).toEqual({ id: 20 });
  });

  it("sem avaliacoes, avgRating fica indefinido", async () => {
    query.mockResolvedValue([{ total_services: 0, total_earnings: 0, avg_rating: null }]);
    await expect(dashboard.getKpis(1)).resolves.toMatchObject({ avgRating: undefined });
  });
});

describe("series do dashboard", () => {
  it("ganhos por mes sempre filtram pelo profissional do token", async () => {
    query.mockResolvedValue([{ month: "09-2026", total: "100.5" }]);

    const result = await dashboard.getEarningsOverTime(1, {
      from: "2026-01-01",
      to: "2026-09-30",
      professionalId: 999,
    } as any);

    expect(result).toEqual([{ month: "09-2026", total: 100.5 }]);
    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain("to_char");
    expect(options.replacements.id).toBe(20);
  });

  it("servicos por categoria convertem contagem para numero", async () => {
    query.mockResolvedValue([{ category: "Limpeza", count: "4" }]);
    await expect(dashboard.getServicesByCategory(1, {})).resolves.toEqual([
      { category: "Limpeza", count: 4 },
    ]);
  });
});

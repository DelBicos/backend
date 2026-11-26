jest.mock("../../config/database");
jest.mock("../../services/dashboard/dashboard.service", () => ({
  getKpis: jest.fn(),
  getEarningsOverTime: jest.fn(),
  getServicesByCategory: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as DashboardService from "../../services/dashboard/dashboard.service";
import { HttpError } from "../../errors/HttpError";
import {
  getDashboardKpis as kpisHandler,
  getEarningsOverTime as earningsHandler,
  getServicesByCategory as byCategoryHandler,
} from "../dashboard.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const service = DashboardService as unknown as Record<string, jest.Mock>;
const getDashboardKpis = settled(kpisHandler);
const getEarningsOverTime = settled(earningsHandler);
const getServicesByCategory = settled(byCategoryHandler);

beforeEach(() => jest.clearAllMocks());

describe("dashboard.controller", () => {
  it.each([
    ["getDashboardKpis", getDashboardKpis],
    ["getEarningsOverTime", getEarningsOverTime],
    ["getServicesByCategory", getServicesByCategory],
  ])("%s exige usuario autenticado (401)", async (_name, handler) => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("devolve os KPIs do usuario autenticado", async () => {
    service.getKpis.mockResolvedValue({ totalEarnings: 300, appointments: 3 });
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 4 } }), res);
    expect(service.getKpis).toHaveBeenCalledWith(4);
    expect(res.json).toHaveBeenCalledWith({
      totalEarnings: 300,
      appointments: 3,
    });
  });

  it("repassa o 404 quando o usuario nao e profissional", async () => {
    service.getKpis.mockRejectedValue(
      HttpError.notFound("Profissional não encontrado"),
    );
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Profissional não encontrado",
    });
  });

  it("falha inesperada vira 500 generico", async () => {
    service.getKpis.mockRejectedValue(new Error("db fora"));
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Erro interno do servidor",
    });
  });

  it("repassa os filtros da query para ganhos e categorias", async () => {
    service.getEarningsOverTime.mockResolvedValue([
      { month: "2026-11", total: 10 },
    ]);
    service.getServicesByCategory.mockResolvedValue([
      { category: "Elétrica", count: 2 },
    ]);
    const query = { period: "6m" };

    const earnings = mockRes();
    await getEarningsOverTime(mockReq({ user: { id: 4 }, query }), earnings);
    expect(service.getEarningsOverTime).toHaveBeenCalledWith(4, query);
    expect(earnings.json).toHaveBeenCalledWith([
      { month: "2026-11", total: 10 },
    ]);

    const byCategory = mockRes();
    await getServicesByCategory(
      mockReq({ user: { id: 4 }, query }),
      byCategory,
    );
    expect(service.getServicesByCategory).toHaveBeenCalledWith(4, query);
    expect(byCategory.json).toHaveBeenCalledWith([
      { category: "Elétrica", count: 2 },
    ]);
  });

  it("repassa o 400 do servico para filtro invalido", async () => {
    service.getEarningsOverTime.mockRejectedValue(
      HttpError.badRequest("professionalId inválido"),
    );
    const res = mockRes();
    await getEarningsOverTime(
      mockReq({ user: { id: 4 }, query: { professionalId: "x" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

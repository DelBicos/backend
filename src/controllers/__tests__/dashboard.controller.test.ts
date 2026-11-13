jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn() },
}));

import { sequelize } from "../../config/database";
import { ProfessionalModel } from "../../models/Professional";
import {
  getDashboardKpis,
  getEarningsOverTime,
} from "../dashboard.controller";
import { mockReq, mockRes } from "../../test/http";

describe("dashboard.controller", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 401 when the user is missing", async () => {
    const res = mockRes();
    await getDashboardKpis(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
  });

  it("returns 404 when the user is not a professional", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Profissional não encontrado para este usuário",
    });
  });

  it("returns KPI numbers from the aggregate query", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue({ id: 7 });
    jest.spyOn(sequelize, "query").mockResolvedValue([
      { totalServices: "2", totalEarnings: "15.5", avgRating: "4.5" },
    ] as any);
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.json).toHaveBeenCalledWith({
      totalServices: 2,
      totalEarnings: 15.5,
      avgRating: 4.5,
    });
  });

  it("returns 500 when the KPI query fails", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue({ id: 7 });
    const res = mockRes();
    await getDashboardKpis(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno" });
  });

  it("returns 400 when the requested professionalId is not a number", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue({ id: 7 });
    const res = mockRes();
    await getEarningsOverTime(
      mockReq({ user: { id: 1 }, query: { professionalId: "abc" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "professionalId inválido" });
  });
});

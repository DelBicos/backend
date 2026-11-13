import bcrypt from "bcryptjs";

jest.mock("../../models/User", () => ({
  UserModel: { findOne: jest.fn() },
}));
jest.mock("../../models/Admin", () => ({
  AdminModel: { findOne: jest.fn() },
}));

import { sequelize } from "../../config/database";
import { AdminModel } from "../../models/Admin";
import { UserModel } from "../../models/User";
import { adminLogin, getAdminStats } from "../admin.controller";
import { mockReq, mockRes } from "../../test/http";

describe("adminLogin", () => {
  it("returns 400 when email or password is missing", async () => {
    const res = mockRes();
    await adminLogin(mockReq({ body: { email: "a@a.com" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Email e senha obrigatórios" });
  });

  it("returns 404 when the user does not exist", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await adminLogin(
      mockReq({ body: { email: "a@a.com", password: "x" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 401 when the password does not match", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      password: await bcrypt.hash("right", 4),
    });
    const res = mockRes();
    await adminLogin(
      mockReq({ body: { email: "a@a.com", password: "wrong" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Senha inválida" });
  });

  it("returns 403 when the user is not an admin", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Ana",
      email: "a@a.com",
      phone: "1",
      password: await bcrypt.hash("right", 4),
    });
    (AdminModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await adminLogin(
      mockReq({ body: { email: "a@a.com", password: "right" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Apenas administradores têm acesso",
    });
  });

  it("returns 200 and a token for an administrator", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Ana",
      email: "a@a.com",
      phone: "1",
      password: await bcrypt.hash("right", 4),
    });
    (AdminModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    const res = mockRes();
    await adminLogin(
      mockReq({ body: { email: "a@a.com", password: "right" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: 1, admin: true }),
        token: expect.any(String),
      }),
    );
  });

  it("returns 500 when the lookup throws", async () => {
    (UserModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await adminLogin(
      mockReq({ body: { email: "a@a.com", password: "right" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno" });
  });
});

describe("getAdminStats", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 500 when the database query is refused", async () => {
    const res = mockRes();
    await getAdminStats(mockReq({ query: { year: "2026" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro ao buscar estatísticas" });
  });

  it("aggregates monthly counts from the query results", async () => {
    jest
      .spyOn(sequelize, "query")
      .mockResolvedValueOnce([{ month: 1, count: 2 }] as any)
      .mockResolvedValueOnce([{ month: 1, count: 1 }] as any)
      .mockResolvedValueOnce([{ month: 1, status: "completed", count: 3 }] as any)
      .mockResolvedValueOnce([{ status: "completed", count: 3 }] as any);

    const res = mockRes();
    await getAdminStats(mockReq({ query: { year: "2026" } }) as any, res);

    const body = res.json.mock.calls[0][0];
    expect(body.year).toBe(2026);
    expect(body.usersByMonth[0]).toEqual({ month: 1, count: 2 });
    expect(body.servicesSummary.completed).toBe(3);
    expect(body.servicesSummary.total).toBe(3);
    expect(res.status).not.toHaveBeenCalled();
  });
});

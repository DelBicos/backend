jest.mock("../../config/database");
jest.mock("../../services/auth/credentials.rules", () => ({
  findUserByEmail: jest.fn(),
  verifyPassword: jest.fn(),
}));
jest.mock("../../models/Admin", () => ({ AdminModel: { findOne: jest.fn() } }));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../services/admin/stats.service", () => ({
  getStats: jest.fn(),
}));
jest.mock("../../services/appointment/dispute.service", () => ({
  listDisputes: jest.fn(),
  resolveDispute: jest.fn(),
}));
jest.mock("../../services/verification/identity.service", () => ({
  listForReview: jest.fn(),
  reviewIdentity: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import {
  findUserByEmail,
  verifyPassword,
} from "../../services/auth/credentials.rules";
import { AdminModel } from "../../models/Admin";
import * as AdminStats from "../../services/admin/stats.service";
import * as Disputes from "../../services/appointment/dispute.service";
import * as Identity from "../../services/verification/identity.service";
import { verifyToken } from "../../utils/jwt.util";
import * as controller from "../admin.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const findUser = findUserByEmail as jest.Mock;
const checkPassword = verifyPassword as jest.Mock;
const findAdmin = AdminModel.findOne as jest.Mock;
const stats = AdminStats as unknown as Record<string, jest.Mock>;
const disputes = Disputes as unknown as Record<string, jest.Mock>;
const identity = Identity as unknown as Record<string, jest.Mock>;

const user = {
  id: 5,
  name: "Admin",
  email: "admin@delbicos.com.br",
  phone: "11",
  password: "hash",
};
const login = (body: Record<string, unknown>) => mockReq({ body });

const previousSecret = process.env.SECRET_KEY;
beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = previousSecret;
});
beforeEach(() => jest.clearAllMocks());

describe("adminLogin", () => {
  it("exige e-mail e senha (400)", async () => {
    const res = mockRes();
    await controller.adminLogin(login({ email: "admin@delbicos.com.br" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(findUser).not.toHaveBeenCalled();
  });

  it("responde igual para e-mail inexistente e senha errada (401)", async () => {
    findUser.mockResolvedValueOnce(null);
    checkPassword.mockResolvedValueOnce(false);
    const unknown = mockRes();
    await controller.adminLogin(
      login({ email: "x@y.com", password: "1234" }),
      unknown,
    );

    findUser.mockResolvedValueOnce(user);
    checkPassword.mockResolvedValueOnce(false);
    const wrong = mockRes();
    await controller.adminLogin(
      login({ email: user.email, password: "errada" }),
      wrong,
    );

    for (const res of [unknown, wrong]) {
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "E-mail ou senha inválidos",
      });
    }
  });

  it("normaliza o e-mail antes de buscar", async () => {
    findUser.mockResolvedValue(null);
    checkPassword.mockResolvedValue(false);
    await controller.adminLogin(
      login({ email: "  Admin@DelBicos.com.br ", password: "1" }),
      mockRes(),
    );
    expect(findUser).toHaveBeenCalledWith("admin@delbicos.com.br");
  });

  it("recusa usuario que nao e administrador (403)", async () => {
    findUser.mockResolvedValue(user);
    checkPassword.mockResolvedValue(true);
    findAdmin.mockResolvedValue(null);
    const res = mockRes();
    await controller.adminLogin(
      login({ email: user.email, password: "1234" }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("devolve token de administrador sem expor a senha", async () => {
    findUser.mockResolvedValue(user);
    checkPassword.mockResolvedValue(true);
    findAdmin.mockResolvedValue({ id: 1, user_id: 5 });
    const res = mockRes();
    await controller.adminLogin(
      login({ email: user.email, password: "1234" }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.user).toEqual({
      id: 5,
      name: "Admin",
      email: user.email,
      admin: true,
    });
    const decoded = verifyToken<{ admin: boolean; user: { id: number } }>(
      body.token,
    );
    expect(decoded.admin).toBe(true);
    expect(decoded.user.id).toBe(5);
    expect(JSON.stringify(body)).not.toContain("hash");
  });

  it("falha inesperada vira 500", async () => {
    findUser.mockRejectedValue(new Error("db fora"));
    const res = mockRes();
    await controller.adminLogin(
      login({ email: user.email, password: "1234" }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno" });
  });
});

describe("painel do administrador", () => {
  it("repassa o ano da query para as estatisticas", async () => {
    stats.getStats.mockResolvedValue({ year: 2026, months: [] });
    const res = mockRes();
    await settled(controller.getAdminStats)(
      mockReq({ query: { year: "2026" } }),
      res,
    );
    expect(stats.getStats).toHaveBeenCalledWith("2026");
    expect(res.json).toHaveBeenCalledWith({ year: 2026, months: [] });
  });

  it("lista disputas pelo status", async () => {
    disputes.listDisputes.mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await settled(controller.listDisputes)(
      mockReq({ query: { status: "open" } }),
      res,
    );
    expect(disputes.listDisputes).toHaveBeenCalledWith("open");
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("resolver disputa exige admin autenticado e repassa os campos do corpo", async () => {
    const anon = mockRes();
    await settled(controller.resolveDispute)(
      mockReq({ params: { id: "3" } }),
      anon,
    );
    expect(anon.status).toHaveBeenCalledWith(401);

    disputes.resolveDispute.mockResolvedValue({ id: 3, status: "resolved" });
    const res = mockRes();
    await settled(controller.resolveDispute)(
      mockReq({
        user: { id: 5 },
        params: { id: "3" },
        body: {
          resolution: "refund",
          refundCents: 500,
          note: "ok",
          extra: "ignorado",
        },
      }),
      res,
    );
    expect(disputes.resolveDispute).toHaveBeenCalledWith(5, 3, {
      resolution: "refund",
      refundCents: 500,
      note: "ok",
    });
    expect(res.json).toHaveBeenCalledWith({ id: 3, status: "resolved" });
  });

  it("lista e revisa verificacoes de identidade", async () => {
    identity.listForReview.mockResolvedValue([{ id: 8 }]);
    const list = mockRes();
    await settled(controller.listVerifications)(
      mockReq({ query: { status: "pending" } }),
      list,
    );
    expect(list.json).toHaveBeenCalledWith({ verifications: [{ id: 8 }] });

    const anon = mockRes();
    await settled(controller.reviewVerification)(
      mockReq({ params: { id: "8" } }),
      anon,
    );
    expect(anon.status).toHaveBeenCalledWith(401);

    identity.reviewIdentity.mockResolvedValue({ id: 8, status: "approved" });
    const review = mockRes();
    await settled(controller.reviewVerification)(
      mockReq({
        user: { id: 5 },
        params: { id: "8" },
        body: { decision: "approve" },
      }),
      review,
    );
    expect(identity.reviewIdentity).toHaveBeenCalledWith(5, "8", {
      decision: "approve",
    });
  });
});

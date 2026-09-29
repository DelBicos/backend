jest.mock("../../config/database");
jest.mock("../../models/Admin");

import type { Request, Response } from "express";
import { AdminModel } from "../../models/Admin";
import { signToken } from "../../utils/jwt.util";
import adminAuth from "../admin.middleware";

const mocked = (fn: unknown) => fn as jest.Mock;

beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
});
beforeEach(() => jest.clearAllMocks());

function call(authorization?: string) {
  const req = { header: () => authorization } as unknown as Request & { user?: { id: number } };
  const out: { status?: number; next?: unknown } = {};
  const res = {
    status(status: number) {
      out.status = status;
      return { json: () => undefined };
    },
  } as unknown as Response;
  return adminAuth(req, res, (error?: unknown) => (out.next = error ?? true)).then(() => ({ req, ...out }));
}

const tokenFor = (id: number) =>
  signToken({ user: { id, name: "A", email: "a@x.com", phone: "1" } });

describe("adminAuth", () => {
  it("recusa (401) sem token", async () => {
    expect((await call()).status).toBe(401);
  });

  it("recusa (403) token invalido", async () => {
    expect((await call("Bearer abc.def.ghi")).status).toBe(403);
  });

  it("recusa (403) usuario que nao e administrador", async () => {
    mocked(AdminModel.findOne).mockResolvedValue(null);
    expect((await call(`Bearer ${tokenFor(9)}`)).status).toBe(403);
  });

  it("libera o administrador e anexa o usuario na requisicao", async () => {
    mocked(AdminModel.findOne).mockResolvedValue({ id: 1 });
    const result = await call(`Bearer ${tokenFor(16)}`);
    expect(result.next).toBe(true);
    expect(result.req.user).toMatchObject({ id: 16 });
    expect(AdminModel.findOne).toHaveBeenCalledWith({ where: { user_id: 16 } });
  });

  it("encaminha falha do banco ao tratador de erros", async () => {
    mocked(AdminModel.findOne).mockRejectedValue(new Error("db"));
    expect((await call(`Bearer ${tokenFor(16)}`)).next).toBeInstanceOf(Error);
  });
});

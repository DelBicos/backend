import jwt from "jsonwebtoken";
import adminAuth from "../admin.middleware";
import { mockReq, mockRes } from "../../test/http";

jest.mock("../../models/Admin", () => ({
  AdminModel: { findOne: jest.fn() },
}));

import { AdminModel } from "../../models/Admin";

const findOne = AdminModel.findOne as jest.Mock;

describe("adminAuth middleware", () => {
  const sign = (user?: { id: number }) =>
    jwt.sign(user ? { user } : {}, process.env.SECRET_KEY || "secret");

  it("returns 401 when no token is sent", async () => {
    const res = mockRes();
    const next = jest.fn();

    await adminAuth(mockReq() as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      msg: "Acesso negado. É obrigatório o envio de token JWT",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the token has no user id", async () => {
    const req = mockReq({ headers: { Authorization: `Bearer ${sign()}` } });
    const res = mockRes();

    await adminAuth(req as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ msg: "Token inválido" });
  });

  it("returns 403 when the user is not an administrator", async () => {
    findOne.mockResolvedValue(null);
    const req = mockReq({
      headers: { Authorization: `Bearer ${sign({ id: 9 })}` },
    });
    const res = mockRes();
    const next = jest.fn();

    await adminAuth(req as any, res, next);

    expect(findOne).toHaveBeenCalledWith({ where: { user_id: 9 } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      msg: "Acesso negado: somente administradores",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next and attaches the user when the admin record exists", async () => {
    findOne.mockResolvedValue({ id: 1, user_id: 9 });
    const req = mockReq({
      headers: { Authorization: `Bearer ${sign({ id: 9 })}` },
    });
    const res = mockRes();
    const next = jest.fn();

    await adminAuth(req as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user).toEqual({ id: 9 });
    expect(res.status).not.toHaveBeenCalled();
  });
});

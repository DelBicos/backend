import jwt from "jsonwebtoken";
import auth from "../auth.middleware";
import { mockReq, mockRes } from "../../test/http";

describe("auth middleware", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await auth(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      msg: "Acesso negado. É obrgatório o envio de token JWT",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the token is invalid", async () => {
    const req = mockReq({
      headers: { Authorization: "Bearer not-a-token" },
    });
    const res = mockRes();
    const next = jest.fn();

    await auth(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ msg: "Token inválido" });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the payload and calls next for a valid token", async () => {
    const payload = {
      user: { id: 1, name: "Ana", email: "ana@example.com", phone: "11999" },
      client: { id: 2, cpf: "123" },
      address: { city: "São Paulo", state: "SP" },
    };
    const token = jwt.sign(payload, process.env.SECRET_KEY || "secret");
    const req = mockReq({ headers: { Authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    await auth(req as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user).toEqual(payload.user);
    expect((req as any).client).toEqual(payload.client);
    expect((req as any).address).toEqual(payload.address);
    expect(res.status).not.toHaveBeenCalled();
  });
});

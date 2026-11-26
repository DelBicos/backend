import { signToken } from "../../utils/jwt.util";
import auth from "../auth.middleware";
import { mockReq, mockRes } from "../../controllers/__tests__/handlerTestUtils";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const previousSecret = process.env.SECRET_KEY;
beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = previousSecret;
});

describe("auth middleware", () => {
  it("responde 401 sem o cabecalho Authorization", () => {
    const res = mockRes();
    const next = jest.fn();

    auth(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      msg: "Acesso negado. É obrgatório o envio de token JWT",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("responde 401 quando o esquema nao e Bearer", () => {
    const res = mockRes();
    auth(mockReq({ headers: { Authorization: "Basic abc" } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("responde 403 para token invalido", () => {
    const res = mockRes();
    const next = jest.fn();

    auth(
      mockReq({ headers: { Authorization: "Bearer nao-e-token" } }),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ msg: "Token inválido" });
    expect(next).not.toHaveBeenCalled();
  });

  it("responde 403 para token valido sem usuario", () => {
    const res = mockRes();
    const token = signToken({ client: { id: 2, cpf: "123" } });
    auth(
      mockReq({ headers: { Authorization: `Bearer ${token}` } }),
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("preenche a requisicao e chama next para token valido", () => {
    const payload = {
      user: { id: 1, name: "Ana", email: "ana@example.com", phone: "11999" },
      client: { id: 2, cpf: "123" },
      address: { city: "São Paulo", state: "SP" },
    };
    const token = signToken(payload, { jwtid: "sessao-1" });
    const req = mockReq({ headers: { Authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    auth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(payload.user);
    expect(req.client).toEqual(payload.client);
    expect(req.address).toEqual(payload.address);
    expect(req.authSessionId).toBe("sessao-1");
    expect(res.status).not.toHaveBeenCalled();
  });
});

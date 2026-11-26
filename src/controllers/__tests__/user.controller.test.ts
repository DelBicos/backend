jest.mock("../../config/database");
jest.mock("../../services/auth/account.service", () => ({
  login: jest.fn(),
  getUserProfile: jest.fn(),
  changePassword: jest.fn(),
  getMe: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock("../../models/User", () => ({ UserModel: { findByPk: jest.fn() } }));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as AccountService from "../../services/auth/account.service";
import { HttpError } from "../../errors/HttpError";
import { UserModel } from "../../models/User";
import * as controller from "../user.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const account = AccountService as unknown as Record<string, jest.Mock>;
const findByPk = UserModel.findByPk as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("user.controller - conta", () => {
  it("login repassa a requisicao e o corpo e responde 200", async () => {
    account.login.mockResolvedValue({ token: "t" });
    const body = { email: "ana@example.com", password: "1234" };
    const req = mockReq({ body });
    const res = mockRes();
    await settled(controller.logInUser)(req, res);
    expect(account.login).toHaveBeenCalledWith(req, body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ token: "t" });
  });

  it("login invalido repassa o 401 do servico", async () => {
    account.login.mockRejectedValue(
      HttpError.unauthorized("E-mail ou senha inválidos"),
    );
    const res = mockRes();
    await settled(controller.logInUser)(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "E-mail ou senha inválidos",
    });
  });

  it("perfil por id passa o usuario do token para o servico decidir o acesso", async () => {
    account.getUserProfile.mockResolvedValue({ id: 2 });
    const res = mockRes();
    await settled(controller.getUserById)(
      mockReq({ user: { id: 1 }, params: { id: "2" } }),
      res,
    );
    expect(account.getUserProfile).toHaveBeenCalledWith(1, "2");
    expect(res.json).toHaveBeenCalledWith({ id: 2 });
  });

  it.each([
    ["changePassword", controller.changePassword],
    ["getUserByToken", controller.getUserByToken],
    ["updateUserProfile", controller.updateUserProfile],
    ["getLocationConsent", controller.getLocationConsent],
    ["acceptLocationConsent", controller.acceptLocationConsent],
    ["revokeLocationConsent", controller.revokeLocationConsent],
  ])("%s exige usuario autenticado (401)", async (_name, handler) => {
    const res = mockRes();
    await settled(handler)(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("troca a senha e responde 204 sem corpo", async () => {
    account.changePassword.mockResolvedValue(undefined);
    const body = { currentPassword: "1234", newPassword: "abcdef" };
    const res = mockRes();
    await settled(controller.changePassword)(
      mockReq({ user: { id: 1 }, body }),
      res,
    );
    expect(account.changePassword).toHaveBeenCalledWith(1, body);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("le e atualiza os dados do proprio usuario", async () => {
    account.getMe.mockResolvedValue({ id: 1 });
    account.updateProfile.mockResolvedValue({ id: 1, name: "Ana" });

    const me = mockRes();
    await settled(controller.getUserByToken)(mockReq({ user: { id: 1 } }), me);
    expect(account.getMe).toHaveBeenCalledWith(1);
    expect(me.json).toHaveBeenCalledWith({ id: 1 });

    const updated = mockRes();
    await settled(controller.updateUserProfile)(
      mockReq({ user: { id: 1 }, body: { name: "Ana" } }),
      updated,
    );
    expect(account.updateProfile).toHaveBeenCalledWith(1, { name: "Ana" });
    expect(updated.json).toHaveBeenCalledWith({ id: 1, name: "Ana" });
  });
});

describe("user.controller - consentimento de localizacao", () => {
  const userRow = (fields: Record<string, unknown>) => {
    const row = { id: 1, ...fields, update: jest.fn() };
    row.update.mockImplementation(async (changes: Record<string, unknown>) =>
      Object.assign(row, changes),
    );
    return row;
  };

  it("responde 404 quando o usuario nao existe mais", async () => {
    findByPk.mockResolvedValue(null);
    const res = mockRes();
    await settled(controller.getLocationConsent)(
      mockReq({ user: { id: 1 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("mostra o consentimento atual com nulos quando nunca foi dado", async () => {
    findByPk.mockResolvedValue(userRow({ location_consent_accepted: null }));
    const res = mockRes();
    await settled(controller.getLocationConsent)(
      mockReq({ user: { id: 1 } }),
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      accepted: false,
      accepted_at: null,
      revoked_at: null,
    });
  });

  it("aceitar registra a data e limpa a revogacao anterior", async () => {
    const row = userRow({
      location_consent_accepted: false,
      location_consent_revoked_at: new Date("2026-01-01"),
    });
    findByPk.mockResolvedValue(row);
    const res = mockRes();
    await settled(controller.acceptLocationConsent)(
      mockReq({ user: { id: 1 } }),
      res,
    );

    expect(row.update).toHaveBeenCalledWith({
      location_consent_accepted: true,
      location_consent_at: expect.any(Date),
      location_consent_revoked_at: null,
    });
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe("Consentimento de localização registrado.");
    expect(body.consent).toEqual({
      accepted: true,
      accepted_at: expect.any(Date),
      revoked_at: null,
    });
  });

  it("revogar desliga o consentimento e registra a data", async () => {
    const accepted = new Date("2026-11-01");
    const row = userRow({
      location_consent_accepted: true,
      location_consent_at: accepted,
    });
    findByPk.mockResolvedValue(row);
    const res = mockRes();
    await settled(controller.revokeLocationConsent)(
      mockReq({ user: { id: 1 } }),
      res,
    );

    expect(row.update).toHaveBeenCalledWith({
      location_consent_accepted: false,
      location_consent_revoked_at: expect.any(Date),
    });
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe("Consentimento de localização revogado.");
    expect(body.consent).toEqual({
      accepted: false,
      accepted_at: accepted,
      revoked_at: expect.any(Date),
    });
  });
});

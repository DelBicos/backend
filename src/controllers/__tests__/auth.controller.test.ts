jest.mock("../../config/database");
jest.mock("../../services/auth/registration.service", () => ({
  startRegistration: jest.fn(),
  verifyRegistration: jest.fn(),
  resendCode: jest.fn(),
}));
jest.mock("../../services/auth/account.service", () => ({
  loginWithMfa: jest.fn(),
}));
jest.mock("../../services/auth/mfa.service", () => ({
  resendMfaChallenge: jest.fn(),
}));
jest.mock("../../services/auth/passwordReset.service", () => ({
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import type { RequestHandler } from "express";
import * as RegistrationService from "../../services/auth/registration.service";
import * as AccountService from "../../services/auth/account.service";
import * as MfaService from "../../services/auth/mfa.service";
import * as PasswordResetService from "../../services/auth/passwordReset.service";
import { HttpError } from "../../errors/HttpError";
import { AuthController } from "../auth.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const asMock = (fn: unknown) => fn as jest.Mock;

/** [handler, funcao do servico, recebe a requisicao como 1o argumento] */
const cases: [string, RequestHandler, jest.Mock, boolean][] = [
  [
    "handleRegister",
    AuthController.handleRegister,
    asMock(RegistrationService.startRegistration),
    false,
  ],
  [
    "handleVerifyCode",
    AuthController.handleVerifyCode,
    asMock(RegistrationService.verifyRegistration),
    true,
  ],
  [
    "handleResendCode",
    AuthController.handleResendCode,
    asMock(RegistrationService.resendCode),
    false,
  ],
  [
    "handleMfaVerify",
    AuthController.handleMfaVerify,
    asMock(AccountService.loginWithMfa),
    true,
  ],
  [
    "handleMfaResend",
    AuthController.handleMfaResend,
    asMock(MfaService.resendMfaChallenge),
    false,
  ],
  [
    "handleForgotPassword",
    AuthController.handleForgotPassword,
    asMock(PasswordResetService.requestPasswordReset),
    false,
  ],
  [
    "handleResetPassword",
    AuthController.handleResetPassword,
    asMock(PasswordResetService.resetPassword),
    false,
  ],
];

beforeEach(() => jest.clearAllMocks());

describe("AuthController", () => {
  it.each(cases)(
    "%s repassa o corpo ao servico e responde 200",
    async (_name, handler, service, withReq) => {
      service.mockResolvedValue({ ok: true });
      const body = { email: "ana@example.com", code: "123456" };
      const req = mockReq({ body });
      const res = mockRes();

      await settled(handler)(req, res);

      expect(service).toHaveBeenCalledWith(...(withReq ? [req, body] : [body]));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    },
  );

  it.each(cases)(
    "%s usa corpo vazio quando nao ha body",
    async (_name, handler, service, withReq) => {
      service.mockResolvedValue({});
      const req = mockReq({ body: undefined });
      await settled(handler)(req, mockRes());
      expect(service).toHaveBeenCalledWith(...(withReq ? [req, {}] : [{}]));
    },
  );

  it("repassa o erro de dominio do servico (ex.: codigo invalido)", async () => {
    asMock(RegistrationService.verifyRegistration).mockRejectedValue(
      HttpError.badRequest("Código inválido ou expirado"),
    );
    const res = mockRes();
    await settled(AuthController.handleVerifyCode)(
      mockReq({ body: { code: "000000" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Código inválido ou expirado",
    });
  });

  it("falha inesperada vira 500 generico", async () => {
    asMock(PasswordResetService.requestPasswordReset).mockRejectedValue(
      new Error("smtp fora"),
    );
    const res = mockRes();
    await settled(AuthController.handleForgotPassword)(
      mockReq({ body: { email: "a@b.com" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Erro interno do servidor",
    });
  });
});

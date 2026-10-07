import bcrypt from "bcryptjs";
import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../models/User");
jest.mock("../../email.service", () => ({
  EmailService: { sendTransactionalEmail: jest.fn() },
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../utils/verification", () => ({
  generateVerificationCode: jest.fn(() => "123456"),
}));

import { UserModel } from "../../../models/User";
import { EmailService } from "../../email.service";
import {
  passwordResets,
  RESET_REQUESTED_MESSAGE,
  requestPasswordReset,
  resetPassword,
} from "../passwordReset.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Ana Souza",
  email: "ana@x.com",
  active: true,
  password: "old-hash",
  save: jest.fn(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  passwordResets.delete("ana@x.com");
  mocked(EmailService.sendTransactionalEmail).mockResolvedValue(true);
});

describe("requestPasswordReset", () => {
  it("envia o codigo para uma conta ativa", async () => {
    mocked(UserModel.findOne).mockResolvedValue(account());
    await expect(requestPasswordReset({ email: " ANA@x.com " })).resolves.toEqual({
      message: RESET_REQUESTED_MESSAGE,
    });
    const sent = mocked(EmailService.sendTransactionalEmail).mock.calls[0][0];
    expect(sent.to).toBe("ana@x.com");
    expect(sent.html).toContain("123456");
    expect(sent.subject).toMatch(/senha/i);
  });

  it("responde igual para e-mail inexistente, sem enviar nada", async () => {
    mocked(UserModel.findOne).mockResolvedValue(null);
    await expect(requestPasswordReset({ email: "x@x.com" })).resolves.toEqual({
      message: RESET_REQUESTED_MESSAGE,
    });
    expect(EmailService.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("nao envia para conta desativada", async () => {
    mocked(UserModel.findOne).mockResolvedValue(account({ active: false }));
    await requestPasswordReset({ email: "ana@x.com" });
    expect(EmailService.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("grava a nova senha com hash e invalida o codigo", async () => {
    const user = account();
    mocked(UserModel.findOne).mockResolvedValue(user);
    await requestPasswordReset({ email: "ana@x.com" });

    await resetPassword({ email: "ana@x.com", code: "123456", password: "nova123" });
    expect(user.save).toHaveBeenCalled();
    expect(bcrypt.compareSync("nova123", user.password)).toBe(true);

    await expectHttpError(
      resetPassword({ email: "ana@x.com", code: "123456", password: "outra123" }),
      404,
    );
  });

  it("recusa codigo errado e senha curta", async () => {
    mocked(UserModel.findOne).mockResolvedValue(account());
    await requestPasswordReset({ email: "ana@x.com" });
    await expectHttpError(
      resetPassword({ email: "ana@x.com", code: "000000", password: "nova123" }),
      400,
    );
    await expectHttpError(
      resetPassword({ email: "ana@x.com", code: "123456", password: "123" }),
      400,
    );
  });

  it("sem pedido ativo, o codigo expirou", async () => {
    await expectHttpError(
      resetPassword({ email: "ana@x.com", code: "123456", password: "nova123" }),
      404,
    );
  });
});

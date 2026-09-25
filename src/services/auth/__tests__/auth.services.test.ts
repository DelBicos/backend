import bcrypt from "bcryptjs";
import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/User");
jest.mock("../../../models/Client");
jest.mock("../../../models/Address");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Notification");
jest.mock("../../email.service", () => ({
  EmailService: { sendTransactionalEmail: jest.fn() },
}));
jest.mock("../../loginLog.service", () => ({ saveLoginLog: jest.fn() }));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logAuth: jest.fn(),
  logError: jest.fn(),
}));

import { sequelize } from "../../../config/database";
import { UserModel } from "../../../models/User";
import { ClientModel } from "../../../models/Client";
import { AddressModel } from "../../../models/Address";
import { ProfessionalModel } from "../../../models/Professional";
import { EmailService } from "../../email.service";
import { saveLoginLog } from "../../loginLog.service";
import { assertPasswordPolicy, normalizeEmail, verifyPassword } from "../credentials";
import * as account from "../account.service";
import * as registration from "../registration.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const req = { ip: "1.2.3.4", headers: {} } as any;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
  return error as HttpError;
};

beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(sequelize, "transaction")
    .mockImplementation(async (cb: any) => cb({ id: "tx" }) as any);
});

describe("credentials", () => {
  it("normaliza e valida e-mail", () => {
    expect(normalizeEmail("  Ana@Email.COM ")).toBe("ana@email.com");
    expect(() => normalizeEmail("sem-arroba")).toThrow(HttpError);
  });

  it("aplica a politica minima de senha do app", () => {
    expect(assertPasswordPolicy("123456")).toBe("123456");
    expect(() => assertPasswordPolicy("12345")).toThrow(HttpError);
    expect(() => assertPasswordPolicy(undefined)).toThrow(HttpError);
  });

  it("verifyPassword e falso sem hash (usuario inexistente)", async () => {
    await expect(verifyPassword("qualquer", undefined)).resolves.toBe(false);
  });
});

describe("login", () => {
  const hash = bcrypt.hashSync("segredo1", 4);
  const user = (overrides = {}) => ({
    id: 1,
    name: "Ana",
    email: "ana@x.com",
    phone: "1",
    password: hash,
    active: true,
    ...overrides,
  });

  it("usa a mesma resposta para e-mail inexistente e senha errada", async () => {
    mocked(UserModel.findOne).mockResolvedValueOnce(null);
    const missing = await expectHttpError(
      account.login(req, { email: "x@x.com", password: "segredo1" }),
      401,
    );
    mocked(UserModel.findOne).mockResolvedValueOnce(user());
    const wrong = await expectHttpError(
      account.login(req, { email: "ana@x.com", password: "errada" }),
      401,
    );
    expect(missing.message).toBe(wrong.message);
  });

  it("bloqueia conta inativa", async () => {
    mocked(UserModel.findOne).mockResolvedValue(user({ active: false }));
    await expectHttpError(account.login(req, { email: "ana@x.com", password: "segredo1" }), 403);
  });

  it("retorna token e perfil profissional do proprio usuario", async () => {
    mocked(UserModel.findOne).mockResolvedValue(user());
    mocked(ClientModel.findOne).mockResolvedValue({ id: 7, cpf: "123", main_address_id: null });
    mocked(ProfessionalModel.findOne).mockResolvedValue({ id: 20, cpf: "123", description: "d" });

    const result = await account.login(req, { email: " ANA@x.com ", password: "segredo1" });

    expect(result.token).toEqual(expect.any(String));
    expect(result.user).toMatchObject({ id: 1, client_id: 7, professional_id: 20 });
    expect(saveLoginLog).toHaveBeenCalled();
  });
});

describe("changePassword / updateProfile", () => {
  it("exige senha atual correta", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ password: bcrypt.hashSync("atual1", 4) });
    await expectHttpError(
      account.changePassword(1, { current_password: "errada", new_password: "novas1" }),
      400,
    );
  });

  it("valida a nova senha e grava hash", async () => {
    const user = { password: bcrypt.hashSync("atual1", 4), save: jest.fn() };
    mocked(UserModel.findByPk).mockResolvedValue(user);
    await expectHttpError(
      account.changePassword(1, { current_password: "atual1", new_password: "123" }),
      400,
    );
    await account.changePassword(1, { current_password: "atual1", new_password: "nova-senha" });
    expect(await bcrypt.compare("nova-senha", user.password)).toBe(true);
    expect(user.save).toHaveBeenCalled();
  });

  it("nao permite trocar para e-mail de outro usuario", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 1, email: "ana@x.com", save: jest.fn() });
    mocked(UserModel.findOne).mockResolvedValue({ id: 2 });
    await expectHttpError(account.updateProfile(1, { email: "bia@x.com" }), 409);
  });

  it("perfil de terceiros nao expoe e-mail/telefone", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 2, name: "Bia", email: "b@x", phone: "9" });
    const other = await account.getUserProfile(1, "2");
    expect(other).not.toHaveProperty("email");
    const self = await account.getUserProfile(2, "2");
    expect(self).toHaveProperty("email", "b@x");
  });
});

describe("registration", () => {
  const input = {
    name: "Ana",
    surname: "Souza",
    email: "Ana@X.com",
    password: "segredo1",
    cpf: "123.456.789-01",
    phone: "15999999999",
    address: { postal_code: "18000-000", street: "Rua A", number: "10" },
  };

  beforeEach(() => {
    mocked(UserModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue(null);
  });

  it("valida campos obrigatorios e endereco", async () => {
    await expectHttpError(registration.startRegistration({ ...input, cpf: undefined }), 400);
    await expectHttpError(registration.startRegistration({ ...input, address: {} }), 400);
  });

  it("recusa e-mail ja cadastrado", async () => {
    mocked(UserModel.findOne).mockResolvedValue({ id: 1 });
    await expectHttpError(registration.startRegistration(input), 409);
  });

  it("escapa o nome no HTML do e-mail e nao guarda a senha em texto puro", async () => {
    mocked(EmailService.sendTransactionalEmail).mockResolvedValue(true);
    await registration.startRegistration({ ...input, name: "<script>x</script>" });

    const html: string = mocked(EmailService.sendTransactionalEmail).mock.calls[0][0].html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");

    const pending = registration.pendingRegistrations.get("ana@x.com")!;
    expect(pending.passwordHash).not.toBe("segredo1");
    expect(await bcrypt.compare("segredo1", pending.passwordHash)).toBe(true);
    expect(pending.cpf).toBe("12345678901");
  });

  it("descarta o cadastro pendente se o e-mail falhar", async () => {
    mocked(EmailService.sendTransactionalEmail).mockResolvedValue(false);
    await expectHttpError(registration.startRegistration(input), 502);
    expect(registration.pendingRegistrations.get("ana@x.com")).toBeUndefined();
  });

  it("verifica o codigo e cria usuario, endereco e cliente na transacao", async () => {
    mocked(EmailService.sendTransactionalEmail).mockResolvedValue(true);
    await registration.startRegistration(input);
    const code = mocked(EmailService.sendTransactionalEmail)
      .mock.calls[0][0].html.match(/(\d{6})\s*<\/span>/)[1];

    mocked(UserModel.create).mockResolvedValue({ id: 1, name: "Ana Souza", email: "ana@x.com" });
    mocked(AddressModel.create).mockResolvedValue({ id: 2 });
    mocked(ClientModel.create).mockResolvedValue({ id: 3, cpf: "12345678901" });

    await expectHttpError(
      registration.verifyRegistration(req, { email: "ana@x.com", code: "000000" }),
      400,
    );
    const result = await registration.verifyRegistration(req, { email: "ANA@x.com", code });

    expect(mocked(UserModel.create).mock.calls[0][0]).toMatchObject({
      name: "Ana Souza",
      email: "ana@x.com",
    });
    expect(mocked(UserModel.create).mock.calls[0][1]).toEqual({ transaction: { id: "tx" } });
    expect(result.token).toEqual(expect.any(String));
    expect(registration.pendingRegistrations.get("ana@x.com")).toBeUndefined();
  });

  it("reenvio sem cadastro pendente retorna SESSION_EXPIRED", async () => {
    const error = await expectHttpError(
      registration.resendCode({ email: "ninguem@x.com" }),
      404,
    );
    expect(error.code).toBe("SESSION_EXPIRED");
  });
});

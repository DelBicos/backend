import { HttpError } from "../../../errors/HttpError";
import bcrypt from "bcryptjs";

jest.mock("../../../config/database");
jest.mock("../../../models/User");
jest.mock("../../email.service", () => ({
  EmailService: { sendTransactionalEmail: jest.fn().mockResolvedValue(true) },
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { UserModel } from "../../../models/User";
import { EmailService } from "../../email.service";
import * as mfa from "../mfa.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const makeUser = (extra: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Ana Souza",
  email: "ana@example.com",
  active: true,
  mfa_enabled: true,
  password: bcrypt.hashSync("segredo1", 4),
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

/** Codigo enviado no ultimo e-mail (extraido do HTML). */
const lastCode = () => {
  const html: string = mocked(EmailService.sendTransactionalEmail).mock.calls.at(-1)![0].html;
  return html.match(/letter-spacing: 8px[^>]*>\s*(\d{6})/)![1];
};

const status = async (p: Promise<unknown>) =>
  (await p.then(() => undefined, (e) => e)) as HttpError;

beforeEach(() => {
  jest.clearAllMocks();
  mocked(EmailService.sendTransactionalEmail).mockResolvedValue(true);
});

describe("maskEmail", () => {
  it("esconde o miolo do usuario", () => {
    expect(mfa.maskEmail("eduardo@gmail.com")).toBe("ed*****@gmail.com");
  });
});

describe("login com MFA", () => {
  it("envia o codigo e devolve um desafio sem sessao", async () => {
    const challenge = await mfa.startMfaChallenge(makeUser() as any);
    expect(challenge).toMatchObject({ mfa_required: true, email_hint: "an*@example.com" });
    expect(challenge.mfa_token).toHaveLength(48);
    expect(EmailService.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("aceita o codigo correto uma unica vez", async () => {
    const user = makeUser();
    mocked(UserModel.findByPk).mockResolvedValue(user);
    const { mfa_token } = await mfa.startMfaChallenge(user as any);

    const found = await mfa.verifyMfaChallenge({ mfa_token, code: lastCode() });
    expect(found.id).toBe(5);

    const again = await status(mfa.verifyMfaChallenge({ mfa_token, code: "123456" }));
    expect(again.status).toBe(404);
  });

  it("recusa codigo errado e bloqueia apos 5 tentativas", async () => {
    const user = makeUser();
    mocked(UserModel.findByPk).mockResolvedValue(user);
    const { mfa_token } = await mfa.startMfaChallenge(user as any);
    const wrong = lastCode() === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i++) {
      expect((await status(mfa.verifyMfaChallenge({ mfa_token, code: wrong }))).status).toBe(400);
    }
    expect((await status(mfa.verifyMfaChallenge({ mfa_token, code: wrong }))).status).toBe(429);
  });

  it("recusa token desconhecido e ausente", async () => {
    expect((await status(mfa.verifyMfaChallenge({ mfa_token: "x", code: "123456" }))).status).toBe(404);
    expect((await status(mfa.verifyMfaChallenge({ code: "123456" }))).status).toBe(400);
  });

  it("nao emite sessao se o MFA foi desligado no meio do caminho", async () => {
    const user = makeUser();
    const { mfa_token } = await mfa.startMfaChallenge(user as any);
    mocked(UserModel.findByPk).mockResolvedValue({ ...user, mfa_enabled: false });
    expect((await status(mfa.verifyMfaChallenge({ mfa_token, code: lastCode() }))).status).toBe(404);
  });

  it("falha com 502 se o e-mail nao sai", async () => {
    mocked(EmailService.sendTransactionalEmail).mockResolvedValue(false);
    expect((await status(mfa.startMfaChallenge(makeUser() as any))).status).toBe(502);
  });

  it("reenvia um novo codigo para o mesmo desafio", async () => {
    const user = makeUser();
    mocked(UserModel.findByPk).mockResolvedValue(user);
    const { mfa_token } = await mfa.startMfaChallenge(user as any);
    await mfa.resendMfaChallenge({ mfa_token });
    expect(EmailService.sendTransactionalEmail).toHaveBeenCalledTimes(2);
    await expect(mfa.verifyMfaChallenge({ mfa_token, code: lastCode() })).resolves.toBeDefined();
  });
});

describe("ativar e desativar", () => {
  it("ativa depois de confirmar o codigo do e-mail", async () => {
    const user = makeUser({ mfa_enabled: false });
    mocked(UserModel.findByPk).mockResolvedValue(user);

    await mfa.requestEnableMfa(5);
    expect(await mfa.confirmEnableMfa(5, { code: lastCode() })).toEqual({ mfa_enabled: true });
    expect(user.mfa_enabled).toBe(true);
    expect(user.save).toHaveBeenCalled();
  });

  it("nao ativa com codigo errado", async () => {
    const user = makeUser({ mfa_enabled: false });
    mocked(UserModel.findByPk).mockResolvedValue(user);
    await mfa.requestEnableMfa(5);
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    expect((await status(mfa.confirmEnableMfa(5, { code: wrong }))).status).toBe(400);
    expect(user.mfa_enabled).toBe(false);
  });

  it("nao pede codigo se ja esta ativo", async () => {
    mocked(UserModel.findByPk).mockResolvedValue(makeUser());
    expect((await status(mfa.requestEnableMfa(5))).status).toBe(409);
  });

  it("desativa somente com a senha correta", async () => {
    const user = makeUser();
    mocked(UserModel.findByPk).mockResolvedValue(user);
    expect((await status(mfa.disableMfa(5, { password: "errada1" }))).status).toBe(400);
    expect(user.mfa_enabled).toBe(true);

    await mfa.disableMfa(5, { password: "segredo1" });
    expect(user.mfa_enabled).toBe(false);
  });
});

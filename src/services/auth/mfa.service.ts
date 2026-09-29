/**
 * Verificacao em duas etapas (MFA) por codigo enviado ao e-mail da conta.
 *
 * - Login: com a senha correta e o MFA ativo, o servidor envia um codigo e
 *   devolve um `mfa_token` aleatorio; a sessao so e emitida com token + codigo.
 * - Ativacao: codigo enviado ao e-mail confirma que a pessoa le aquela caixa.
 * - Desativacao: exige a senha atual.
 *
 * Os codigos ficam em memoria (uma unica instancia no App Service), com
 * validade curta e limite de tentativas, como no cadastro.
 */
import { randomBytes } from "crypto";
import { UserModel } from "../../models/User";
import { HttpError } from "../../errors/HttpError";
import { EmailService } from "../email.service";
import { verificationCodeEmail } from "../../templates/emails/verificationCode";
import { generateVerificationCode } from "../../utils/verification";
import logger from "../../utils/logger";
import { verifyPassword } from "./credentials";
import { CODE_TTL_MS, VerificationCodeStore } from "./pendingRegistration.store";

export const loginChallenges = new VerificationCodeStore<{ userId: number }>();
export const setupChallenges = new VerificationCodeStore<{ userId: number }>();

const setupKey = (userId: number) => `setup:${userId}`;

/** "ed***@gmail.com": mostra ao usuario para onde foi o codigo. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function sendCode(user: UserModel, code: string) {
  const { subject, html } = verificationCodeEmail({
    name: String(user.name ?? "").split(" ")[0] || "cliente",
    code,
    expiresInMinutes: CODE_TTL_MS / 60_000,
    purpose: "mfa",
  });
  if (!(await EmailService.sendTransactionalEmail({ to: user.email, subject, html }))) {
    logger.error("Falha ao enviar código de verificação em duas etapas", { userId: user.id });
    throw new HttpError(502, "Falha ao enviar o e-mail. Tente novamente.");
  }
}

function assertCode(
  store: VerificationCodeStore<{ userId: number }>,
  key: string,
  code: unknown,
): { userId: number } {
  if (!code) throw HttpError.badRequest("Informe o código recebido por e-mail.");
  const result = store.verify(key, String(code).trim());
  if (result.status === "not_found") {
    throw HttpError.notFound("Código expirado. Peça um novo código.").withCode("SESSION_EXPIRED");
  }
  if (result.status === "locked") {
    throw new HttpError(429, "Muitas tentativas inválidas. Peça um novo código.");
  }
  if (result.status === "invalid") throw HttpError.badRequest("Código inválido.");
  return result.data;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/** Chamado depois da senha correta: envia o codigo e devolve o desafio. */
export async function startMfaChallenge(user: UserModel) {
  const mfaToken = randomBytes(24).toString("hex");
  const code = generateVerificationCode();
  loginChallenges.start(mfaToken, { userId: user.id }, code);
  await sendCode(user, code);
  return {
    mfa_required: true as const,
    mfa_token: mfaToken,
    email_hint: maskEmail(user.email),
    message: "Enviamos um código de acesso para o seu e-mail.",
  };
}

/** Confere o codigo do login e devolve o usuario para emitir a sessao. */
export async function verifyMfaChallenge(input: { mfa_token?: unknown; code?: unknown }) {
  const token = String(input.mfa_token ?? "");
  if (!token) throw HttpError.badRequest("Desafio de acesso ausente.");
  const { userId } = assertCode(loginChallenges, token, input.code);

  const user = await UserModel.findByPk(userId);
  if (!user || user.active === false || !user.mfa_enabled) {
    loginChallenges.delete(token);
    throw HttpError.notFound("Código expirado. Entre novamente.").withCode("SESSION_EXPIRED");
  }
  loginChallenges.delete(token);
  return user;
}

/** Novo codigo para um login em andamento. */
export async function resendMfaChallenge(input: { mfa_token?: unknown }) {
  const token = String(input.mfa_token ?? "");
  const data = loginChallenges.get(token);
  const user = data ? await UserModel.findByPk(data.userId) : null;
  if (!data || !user) {
    throw HttpError.notFound("Sessão expirada. Entre novamente.").withCode("SESSION_EXPIRED");
  }
  const code = generateVerificationCode();
  loginChallenges.addCode(token, code);
  await sendCode(user, code);
  return { message: "Enviamos um novo código.", email_hint: maskEmail(user.email) };
}

// ---------------------------------------------------------------------------
// Ativar / desativar
// ---------------------------------------------------------------------------

export async function requestEnableMfa(userId: number) {
  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  if (user.mfa_enabled) throw HttpError.conflict("A verificação em duas etapas já está ativa.");

  const code = generateVerificationCode();
  if (!setupChallenges.addCode(setupKey(userId), code)) {
    setupChallenges.start(setupKey(userId), { userId }, code);
  }
  await sendCode(user, code);
  return { message: "Enviamos um código para o seu e-mail.", email_hint: maskEmail(user.email) };
}

export async function confirmEnableMfa(userId: number, input: { code?: unknown }) {
  assertCode(setupChallenges, setupKey(userId), input.code);
  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  user.mfa_enabled = true;
  await user.save();
  setupChallenges.delete(setupKey(userId));
  logger.info("Verificação em duas etapas ativada", { userId });
  return { mfa_enabled: true };
}

export async function disableMfa(userId: number, input: { password?: unknown }) {
  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  if (!(await verifyPassword(input.password, user.password))) {
    throw HttpError.badRequest("Senha incorreta");
  }
  user.mfa_enabled = false;
  await user.save();
  logger.info("Verificação em duas etapas desativada", { userId });
  return { mfa_enabled: false };
}

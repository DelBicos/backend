/**
 * "Esqueci minha senha": codigo de 6 digitos enviado ao e-mail da conta.
 *
 * A resposta do pedido e sempre a mesma, exista ou nao a conta, para nao
 * revelar quais e-mails estao cadastrados.
 */
import { HttpError } from "../../errors/HttpError";
import { EmailService } from "../email.service";
import { verificationCodeEmail } from "../../templates/emails/verificationCode";
import { generateVerificationCode } from "../../utils/verification";
import logger from "../../utils/logger";
import {
  assertPasswordPolicy,
  findUserByEmail,
  hashPassword,
  normalizeEmail,
} from "./credentials";
import { CODE_TTL_MS, VerificationCodeStore } from "./pendingRegistration.store";

export const passwordResets = new VerificationCodeStore<{ userId: number }>();

export const RESET_REQUESTED_MESSAGE =
  "Se houver uma conta com este e-mail, enviamos um código para criar uma nova senha.";

/** Envia o codigo (ou nada, se a conta nao existir ou estiver desativada). */
export async function requestPasswordReset(input: { email?: unknown }) {
  if (!input.email) throw HttpError.badRequest("E-mail é obrigatório.");
  const email = normalizeEmail(input.email);

  const user = await findUserByEmail(email);
  if (!user || user.active === false) {
    return { message: RESET_REQUESTED_MESSAGE };
  }

  const code = generateVerificationCode();
  // Um novo pedido soma um codigo ao anterior (o e-mail pode atrasar).
  if (!passwordResets.addCode(email, code)) {
    passwordResets.start(email, { userId: user.id }, code);
  }

  const firstName = String(user.name ?? "").split(" ")[0] || "cliente";
  const { subject, html } = verificationCodeEmail({
    name: firstName,
    code,
    expiresInMinutes: CODE_TTL_MS / 60_000,
    purpose: "reset",
  });
  if (!(await EmailService.sendTransactionalEmail({ to: email, subject, html }))) {
    logger.error("Falha ao enviar e-mail de redefinição de senha", { userId: user.id });
    throw new HttpError(502, "Falha ao enviar o e-mail. Tente novamente.");
  }
  return { message: RESET_REQUESTED_MESSAGE };
}

/** Confere o codigo e grava a nova senha. */
export async function resetPassword(input: {
  email?: unknown;
  code?: unknown;
  password?: unknown;
}) {
  if (!input.email || !input.code || !input.password) {
    throw HttpError.badRequest("E-mail, código e nova senha são obrigatórios.");
  }
  const email = normalizeEmail(input.email);
  const password = assertPasswordPolicy(input.password, "nova senha");

  const result = passwordResets.verify(email, String(input.code).trim());
  if (result.status === "not_found") {
    throw HttpError.notFound("Código expirado. Peça um novo código.").withCode(
      "SESSION_EXPIRED",
    );
  }
  if (result.status === "locked") {
    throw new HttpError(429, "Muitas tentativas inválidas. Peça um novo código.");
  }
  if (result.status === "invalid") {
    throw HttpError.badRequest("Código inválido.");
  }

  const user = await findUserByEmail(email);
  if (!user || user.id !== result.data.userId || user.active === false) {
    passwordResets.delete(email);
    throw HttpError.notFound("Código expirado. Peça um novo código.");
  }

  user.password = await hashPassword(password);
  await user.save();
  passwordResets.delete(email);
  logger.info("Senha redefinida por código", { userId: user.id });
  return { message: "Senha alterada. Você já pode entrar com a nova senha." };
}

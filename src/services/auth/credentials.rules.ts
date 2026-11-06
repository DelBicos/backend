/**
 * Regras de credenciais: normalizacao de e-mail, politica e hash de senha.
 */
import bcrypt from "bcryptjs";
import { col, fn, where } from "sequelize";
import { UserModel } from "../../models/User";
import { HttpError } from "../../errors/HttpError";

/** Mesmo minimo exigido pelo formulario de cadastro do app. */
export const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // limite de bytes efetivos do bcrypt
const BCRYPT_ROUNDS = 10;

// Hash de uma senha qualquer, gerado uma unica vez: usado para gastar o mesmo
// tempo quando o e-mail nao existe, sem revelar pela latencia quais contas existem.
let dummyHash: string | undefined;
const getDummyHash = () =>
  (dummyHash ??= bcrypt.hashSync("delbicos-timing-guard", BCRYPT_ROUNDS));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw HttpError.badRequest("E-mail inválido.");
  }
  return email;
}

export function assertPasswordPolicy(value: unknown, field = "senha"): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    throw HttpError.badRequest(
      `A ${field} deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw HttpError.badRequest(
      `A ${field} deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`,
    );
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Compara em tempo aproximadamente constante, exista ou nao o hash. */
export async function verifyPassword(password: unknown, hash?: string | null): Promise<boolean> {
  const matches = await bcrypt.compare(String(password ?? ""), hash || getDummyHash());
  return Boolean(hash) && matches;
}

/** Busca usuario pelo e-mail sem diferenciar maiusculas/minusculas. */
export function findUserByEmail(email: string) {
  return UserModel.findOne({ where: where(fn("lower", col("email")), email) });
}

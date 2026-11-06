import jwt from "jsonwebtoken";
import { getJwtExpiresIn, getJwtSecret } from "../config/env";

const ALGORITHM: jwt.Algorithm = "HS256";

/** Assina um JWT com o segredo e o algoritmo padrao da aplicacao. */
export function signToken(
  payload: object,
  options: Omit<jwt.SignOptions, "algorithm"> = {},
): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn() as jwt.SignOptions["expiresIn"],
    ...options,
    algorithm: ALGORITHM,
  });
}

/** Verifica um JWT aceitando apenas o algoritmo esperado. Lanca se invalido. */
export function verifyToken<T = unknown>(token: string): T {
  return jwt.verify(token, getJwtSecret(), { algorithms: [ALGORITHM] }) as T;
}

/** Extrai o token de um header "Authorization: Bearer <token>". */
export function extractBearerToken(header?: string | null): string | null {
  if (!header) return null;
  const [scheme, token] = header.trim().split(/\s+/);
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

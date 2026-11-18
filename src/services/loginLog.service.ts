import { Request } from "express";
import { createHash } from "crypto";
import { LoginLog } from "../models/LoginLog";
import logger from "../utils/logger";

interface LoginLogData {
  userId: string | number;
  username: string;
  jwt: string;
}

/**
 * Impressao digital do token para correlacao em auditoria. O JWT em si nunca
 * e persistido: quem lesse a colecao de logs poderia reutilizar sessoes ativas.
 */
export function tokenFingerprint(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

/**
 * Salva um log de login no MongoDB de forma assíncrona (fire-and-forget).
 * Não bloqueia a resposta ao cliente e não propaga erros.
 *
 * @param req - Express Request (para extrair IP e User-Agent)
 * @param data - Dados do login (userId, username, jwt — armazenado apenas como fingerprint)
 */
export function saveLoginLog(req: Request, data: LoginLogData): void {
  // Fire-and-forget: não usamos await, a Promise roda em background
  LoginLog.create({
    userId: String(data.userId),
    username: data.username,
    loginDate: new Date(),
    jwt: tokenFingerprint(data.jwt),
    ip: req.ip || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
    status: "SUCCESS",
  }).catch((error) => {
    // Log do erro sem derrubar a API
    logger.error("Falha ao salvar log de login no MongoDB", {
      error: error instanceof Error ? error.message : String(error),
      userId: data.userId,
      username: data.username,
    });
  });
}

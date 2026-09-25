import { Request, Response, NextFunction } from "express";
import { logRequest } from "../utils/logger";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

const SENSITIVE_QUERY_PARAMETERS = new Set([
  "access_token",
  "api_key",
  "authorization",
  "key",
  "selected_time",
  "session_id",
  "timezone",
  "token",
]);

function safeUrlForLog(originalUrl: string): string {
  const separator = originalUrl.indexOf("?");
  if (separator < 0) return originalUrl;

  const path = originalUrl.slice(0, separator);
  const query = new URLSearchParams(originalUrl.slice(separator + 1));
  for (const parameter of SENSITIVE_QUERY_PARAMETERS) {
    if (query.has(parameter)) query.set(parameter, "[redacted]");
  }
  const safeQuery = query.toString();
  return safeQuery ? `${path}?${safeQuery}` : path;
}

/**
 * Middleware para logging automático de todas as requisições HTTP
 * Captura método, URL, status code, tempo de resposta e usuário autenticado
 */
export const loggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = Date.now();
  const { method, originalUrl } = req;
  const loggedUrl = safeUrlForLog(originalUrl);
  let alreadyLogged = false;

  const getUserId = () => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.id;
  };

  // Capturar quando a resposta for finalizada
  res.on("finish", () => {
    if (alreadyLogged) return;
    alreadyLogged = true;

    const duration = Date.now() - startTime;
    const { statusCode } = res;

    // Logar a requisição finalizada normalmente
    logRequest(method, loggedUrl, statusCode, duration, getUserId());
  });

  // Captura conexões encerradas antes do finish (ex.: timeout/abort no cliente)
  res.on("close", () => {
    if (alreadyLogged) return;
    alreadyLogged = true;

    const duration = Date.now() - startTime;
    const statusCode = res.headersSent ? res.statusCode : 499;
    logRequest(
      method,
      loggedUrl,
      statusCode,
      duration,
      getUserId(),
      "request_aborted_before_finish",
    );
  });

  next();
};

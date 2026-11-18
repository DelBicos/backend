/** Ajudantes para tratar `unknown` em blocos catch sem recorrer a `any`. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mensagem legivel de qualquer valor lancado. */
export function errorMessage(error: unknown, fallback = "Erro desconhecido"): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof error === "string" && error ? error : fallback;
}

/** Status HTTP (`status` ou `statusCode`) de um erro, quando existir. */
export function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status ?? error.statusCode;
  return typeof status === "number" ? status : undefined;
}

/** Codigo do erro (`code`) quando existir; ex.: "EADDRINUSE", codigos do Stripe. */
export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

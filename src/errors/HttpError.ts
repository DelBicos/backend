/**
 * Erro de dominio com status HTTP associado.
 *
 * Services lancam HttpError; o errorHandler global converte em resposta
 * JSON no formato { error: string } usado em toda a API.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = "Usuário não autenticado") {
    return new HttpError(401, message);
  }

  static forbidden(message = "Acesso negado") {
    return new HttpError(403, message);
  }

  static notFound(message = "Recurso não encontrado") {
    return new HttpError(404, message);
  }

  static conflict(message: string) {
    return new HttpError(409, message);
  }
}

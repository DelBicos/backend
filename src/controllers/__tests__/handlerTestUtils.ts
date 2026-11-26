import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthenticatedRequest } from "../../interfaces/authentication.interface";
import { errorHandler } from "../../middlewares/error.middleware";

/** `next` que entrega o erro ao errorHandler global, como no servidor. */
export const nextToErrorHandler =
  (getReq: () => unknown, getRes: () => unknown): NextFunction =>
  (error?: unknown) =>
    errorHandler(error, getReq() as Request, getRes() as Response, () => undefined);

/**
 * Os controllers usam `asyncHandler`, que nao devolve a promessa: depois de
 * chamar o handler, aguardamos a fila de microtarefas esvaziar. Sem `next`,
 * os erros vao para o errorHandler global (status + { error } na resposta).
 */
export const settled =
  (handler: RequestHandler) =>
  async (req: unknown, res: unknown, next?: NextFunction) => {
    handler(
      req as Request,
      res as Response,
      next ?? nextToErrorHandler(() => req, () => res),
    );
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };

/** Resposta do Express com `status`, `json` e `send` encadeaveis e espionados. */
export type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
};

export function mockRes(): MockResponse {
  const res = {} as MockResponse;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

/**
 * Requisicao minima para chamar controllers e middlewares direto. Cabecalhos
 * sao lidos sem diferenciar maiusculas, como no Express.
 */
export function mockReq<R extends Request = AuthenticatedRequest>(
  overrides: Record<string, unknown> & { headers?: Record<string, string> } = {},
): R {
  const { headers: headerOverrides, ...rest } = overrides;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(headerOverrides ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const read = (name: string) => headers[name.toLowerCase()];
  return {
    body: {},
    params: {},
    query: {},
    ip: "127.0.0.1",
    header: read,
    get: read,
    ...rest,
    headers,
  } as unknown as R;
}

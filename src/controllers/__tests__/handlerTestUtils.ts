import type { NextFunction, Request, RequestHandler, Response } from "express";
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

import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Registra handlers que recebem uma variante de Request (ex.: com `user`
 * preenchido pelo middleware de auth) sem perder a tipagem do Express.
 */
export function asHandler<R extends Request>(
  handler: (req: R, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return handler as unknown as RequestHandler;
}

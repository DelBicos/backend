import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Encaminha rejeicoes de handlers async para o errorHandler global
 * (Express 4 nao faz isso sozinho).
 */
export const asyncHandler =
  <Req extends Request = Request>(
    handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };

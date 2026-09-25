import { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors/HttpError";
import { logError } from "../utils/logger";

/** 404 para rotas inexistentes. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
}

/**
 * Tratamento centralizado de erros. Erros de dominio (HttpError) viram a
 * resposta correspondente; qualquer outro erro vira 500 generico, sem
 * vazar mensagem interna/stack para o cliente.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  // JSON malformado enviado pelo cliente (body-parser)
  if ((err as any)?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido no corpo da requisição" });
  }
  if ((err as any)?.type === "entity.too.large") {
    return res.status(413).json({ error: "Corpo da requisição muito grande" });
  }

  logError("Erro não tratado na requisição", err as Error, {
    method: req.method,
    path: req.originalUrl,
  });
  return res.status(500).json({ error: "Erro interno do servidor" });
}

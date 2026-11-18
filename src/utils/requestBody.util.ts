import { Request } from "express";
import { isRecord } from "./errors.util";

/** Corpo da requisicao como objeto de valores desconhecidos (nunca undefined). */
export type Body = Record<string, unknown>;

export function bodyOf(req: Request): Body {
  return isRecord(req.body) ? req.body : {};
}

/** Texto nao vazio, ou undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

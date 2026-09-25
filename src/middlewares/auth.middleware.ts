import { NextFunction, Response } from "express";
import {
  AuthenticatedRequest,
  ITokenPayload,
} from "../interfaces/authentication.interface";
import { extractBearerToken, verifyToken } from "../utils/jwt.util";
import logger from "../utils/logger";

/** Exige um JWT valido e popula req.user / req.client / req.address. */
export default function auth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token)
    return res.status(401).json({
      msg: "Acesso negado. É obrgatório o envio de token JWT",
    });

  try {
    const decoded = verifyToken<ITokenPayload>(token);
    if (!decoded?.user?.id) {
      return res.status(403).json({ msg: "Token inválido" });
    }
    req.user = decoded.user;
    req.client = decoded.client;
    req.address = decoded.address;
    req.authSessionId = decoded.jti;
    next();
  } catch (error) {
    logger.warn("Falha na verificação do JWT", {
      reason: (error as Error).message,
    });
    res.status(403).json({
      msg: "Token inválido",
    });
  }
}

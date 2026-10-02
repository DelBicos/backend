import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { ITokenPayload } from "../interfaces/authentication.interface";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

export default async function auth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token)
    return res.status(401).json({
      msg: "Acesso negado. É obrgatório o envio de token JWT",
    });

  try {
    const decoded = jwt.verify(
      token,
      process.env.SECRET_KEY || "secret"
    ) as ITokenPayload;
    req.user = decoded.user;
    req.client = decoded.client;
    req.address = decoded.address;
    req.authSessionId = decoded.jti;
    next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    res.status(403).json({
      msg: "Token inválido",
    });
  }
}

import { Request, Response, NextFunction } from "express";
import { AdminModel } from "../models/Admin";
import { ITokenPayload } from "../interfaces/authentication.interface";
import { extractBearerToken, verifyToken } from "../utils/jwt.util";

/** Exige JWT valido de um usuario cadastrado como administrador. */
export default async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token)
    return res
      .status(401)
      .json({ msg: "Acesso negado. É obrigatório o envio de token JWT" });

  let user: ITokenPayload["user"] | undefined;
  try {
    user = verifyToken<Partial<ITokenPayload>>(token).user;
  } catch {
    return res.status(403).json({ msg: "Token inválido" });
  }
  if (!user?.id) return res.status(403).json({ msg: "Token inválido" });

  try {
    const isAdmin = await AdminModel.findOne({ where: { user_id: user.id } });
    if (!isAdmin)
      return res
        .status(403)
        .json({ msg: "Acesso negado: somente administradores" });

    (req as any).user = user;
    next();
  } catch (error) {
    next(error);
  }
}

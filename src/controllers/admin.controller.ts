import { Request, Response } from "express";
import { findUserByEmail, verifyPassword } from "../services/auth/credentials.rules";
import { signToken } from "../utils/jwt.util";
import { UserModel } from "../models/User";
import { AdminModel } from "../models/Admin";
import { sequelize } from "../config/database";
import { QueryTypes } from "sequelize";
import * as Disputes from "../services/appointment/dispute.service";
import * as AdminStats from "../services/admin/stats.service";
import * as Identity from "../services/verification/identity.service";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../errors/HttpError";

import { logError } from "../utils/logger";
import type { AuthenticatedRequest } from "../interfaces/authentication.interface";
// Removidos imports não usados (AppointmentModel, ProfessionalModel, Op, Sequelize)

export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email e senha obrigatórios" });
  try {
    // Mesma resposta para e-mail inexistente e senha errada (evita enumerar contas).
    const normalized = String(email).trim().toLowerCase();
    const user = await findUserByEmail(normalized);
    const isValid = await verifyPassword(password, user?.password);
    if (!user || !isValid)
      return res.status(401).json({ error: "E-mail ou senha inválidos" });

    const isAdmin = await AdminModel.findOne({ where: { user_id: user.id } });
    if (!isAdmin)
      return res
        .status(403)
        .json({ error: "Apenas administradores têm acesso" });

    const payload = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      admin: true,
    };

    const token = signToken(payload);

    return res
      .status(200)
      .json({
        token,
        user: { id: user.id, name: user.name, email: user.email, admin: true },
      });
  } catch (error) {
    logError("Admin login error", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  res.json(await AdminStats.getStats(req.query.year));
});

export const listDisputes = asyncHandler(async (req, res) => {
  res.json(await Disputes.listDisputes(req.query.status));
});

export const resolveDispute = asyncHandler(async (req, res) => {
  const adminUserId = (req as AuthenticatedRequest).user?.id;
  if (!adminUserId) throw HttpError.unauthorized();
  const dispute = await Disputes.resolveDispute(adminUserId, Number(req.params.id), {
    resolution: req.body?.resolution,
    refundCents: req.body?.refundCents,
    note: req.body?.note,
  });
  res.json(dispute);
});

// GET /api/admin/verifications?status=pending|approved|rejected|all
export const listVerifications = asyncHandler(async (req: Request, res: Response) => {
  res.json({ verifications: await Identity.listForReview(req.query.status) });
});

// POST /api/admin/verifications/:id/review
export const reviewVerification = asyncHandler(async (req: Request, res: Response) => {
  const adminId = (req as AuthenticatedRequest).user?.id;
  if (!adminId) throw HttpError.unauthorized();
  res.json(await Identity.reviewIdentity(adminId, req.params.id, req.body ?? {}));
});

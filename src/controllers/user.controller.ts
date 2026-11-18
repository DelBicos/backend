import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as AccountService from "../services/auth/account.service";
import { UserModel } from "../models/User";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

// POST /api/user/login
export const logInUser = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await AccountService.login(req, req.body ?? {}));
});

// GET /api/user/:id
export const getUserById = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(await AccountService.getUserProfile(req.user?.id, req.params.id));
});

// POST /api/user/change-password
export const changePassword = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  await AccountService.changePassword(requireUserId(req), req.body ?? {});
  res.status(204).send();
});

// GET /api/user/me
export const getUserByToken = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.status(200).json(await AccountService.getMe(requireUserId(req)));
});

// PUT /api/user/me
export const updateUserProfile = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.status(200).json(await AccountService.updateProfile(requireUserId(req), req.body ?? {}));
});

// --- Consentimento LGPD para rastrear a localizacao durante o atendimento ---

async function requireUser(req: AuthenticatedRequest) {
  const userId = req.user?.id;
  if (!userId) throw HttpError.unauthorized();
  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  return user;
}

const consentView = (user: UserModel) => ({
  accepted: Boolean(user.location_consent_accepted),
  accepted_at: user.location_consent_at ?? null,
  revoked_at: user.location_consent_revoked_at ?? null,
});

export const getLocationConsent = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(consentView(await requireUser(req)));
});

export const acceptLocationConsent = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const user = await requireUser(req);
  await user.update({
    location_consent_accepted: true,
    location_consent_at: new Date(),
    location_consent_revoked_at: null,
  });
  res.json({ message: "Consentimento de localização registrado.", consent: consentView(user) });
});

export const revokeLocationConsent = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const user = await requireUser(req);
  await user.update({ location_consent_accepted: false, location_consent_revoked_at: new Date() });
  res.json({ message: "Consentimento de localização revogado.", consent: consentView(user) });
});

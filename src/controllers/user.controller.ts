import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as AccountService from "../services/auth/account.service";

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

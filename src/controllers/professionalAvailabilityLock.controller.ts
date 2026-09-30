import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as LockService from "../services/professional/availabilityLock.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

// GET /api/professionals/:professionalId/availability-locks
export const listLocks = asyncHandler(async (req: Request, res: Response) => {
  res.json(await LockService.list(req.params.professionalId));
});

// POST /api/professionals/:professionalId/availability-locks
export const createLock = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const created = await LockService.create(
    requireUserId(req),
    req.params.professionalId,
    req.body ?? {},
  );
  res.status(201).json(created);
});

// DELETE /api/availability-locks/:id
export const deleteLockById = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  await LockService.remove(requireUserId(req), req.params.id);
  res.status(204).send();
});

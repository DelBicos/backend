import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as AvailabilityService from "../services/professional/availability.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

// ─── /api/professionals/:professionalId/availabilities ──────────────────────

export const listAvailability = asyncHandler(async (req: Request, res: Response) => {
  res.json(await AvailabilityService.list(req.params.professionalId));
});

export const getAvailability = asyncHandler(async (req: Request, res: Response) => {
  res.json(await AvailabilityService.get(req.params.id, req.params.professionalId));
});

export const createAvailability = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const created = await AvailabilityService.create(
    requireUserId(req),
    req.params.professionalId,
    req.body ?? {},
  );
  res.status(201).json(created);
});

export const updateAvailability = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(
    await AvailabilityService.update(
      requireUserId(req),
      req.params.id,
      req.body ?? {},
      req.params.professionalId,
    ),
  );
});

export const deleteAvailability = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  await AvailabilityService.disable(requireUserId(req), req.params.id, req.params.professionalId);
  res.status(200).json({ message: "Disponibilidade desativada" });
});

// ─── /api/availabilities/:id (sem professionalId no path) ───────────────────

export const getAvailabilityById = asyncHandler(async (req: Request, res: Response) => {
  res.json(await AvailabilityService.get(req.params.id));
});

export const updateAvailabilityById = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(await AvailabilityService.update(requireUserId(req), req.params.id, req.body ?? {}));
});

export const deleteAvailabilityById = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  await AvailabilityService.disable(requireUserId(req), req.params.id);
  res.status(204).send();
});

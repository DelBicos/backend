import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as ProfessionalService from "../services/professional/professional.service";

/** Controllers finos: traduzem HTTP e delegam ao ProfessionalService. */

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

// GET /api/professionals
export const getProfessionals = asyncHandler(async (req: Request, res: Response) => {
  res.json(await ProfessionalService.searchPublic(req.query));
});

// GET /api/professionals/:id
export const getProfessionalById = asyncHandler(async (req: Request, res: Response) => {
  res.json(await ProfessionalService.getPublicProfile(req.params.id));
});

// GET /api/professionals/search-availability
export const searchProfessionalAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(await ProfessionalService.searchAvailability(req.query));
  },
);

// POST /api/professionals
export const createProfessional = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const professional = await ProfessionalService.register(requireUserId(req), req.body ?? {});
  res.status(201).json({ message: "Profissional registrado com sucesso", professional });
});

// PUT /api/professionals/:id
export const updateProfessional = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const professional = await ProfessionalService.update(
    requireUserId(req),
    req.params.id,
    req.body ?? {},
  );
  res.json({ message: "Profissional atualizado", professional });
});

// GET /api/professionals/:id/radius
export const getProfessionalRadius = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(await ProfessionalService.getRadius(requireUserId(req), req.params.id));
});

// PUT /api/professionals/:id/radius
export const updateProfessionalRadius = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(
    await ProfessionalService.updateRadius(
      requireUserId(req),
      req.params.id,
      req.body?.service_radius_km,
    ),
  );
});

import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as CatalogService from "../services/catalog/catalog.service";

/** Controllers finos: traduzem HTTP e delegam ao CatalogService. */

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

// GET /api/professionals/:professionalId/services
export const listServices = asyncHandler(async (req: Request, res: Response) => {
  res.json(await CatalogService.listByProfessional(req.params.professionalId, req.query));
});

// GET /api/services
export const listAllServices = asyncHandler(async (req: Request, res: Response) => {
  res.json(await CatalogService.listPublic(req.query));
});

// GET /api/services/search/semantic
export const searchServicesSemantically = asyncHandler(async (req: Request, res: Response) => {
  res.json(await CatalogService.searchSemantic(req.query));
});

// GET /api/services/:id
export const getService = asyncHandler(async (req: Request, res: Response) => {
  res.json(await CatalogService.getPublicById(req.params.id));
});

// POST /api/services (profissional derivado do token)
export const createServiceSelf = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const service = await CatalogService.createForUser(requireUserId(req), req.body ?? {});
  res.status(201).json({ service });
});

// POST /api/professionals/:professionalId/services (rota legada)
export const createService = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const service = await CatalogService.createForUser(requireUserId(req), req.body ?? {}, {
    professionalId: req.params.professionalId,
  });
  res.status(201).json(service);
});

// PUT /api/services/:id
export const updateService = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(await CatalogService.updateForUser(requireUserId(req), req.params.id, req.body ?? {}));
});

// GET /api/services/my
export const listMyServices = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  res.json(await CatalogService.listForUser(requireUserId(req), req.query));
});

// DELETE /api/services/:id (soft delete)
export const deleteService = asyncHandler<AuthenticatedRequest>(async (req, res) => {
  await CatalogService.deactivateForUser(requireUserId(req), req.params.id);
  res.status(204).send();
});

import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as DashboardService from "../services/dashboard/dashboard.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

export const getDashboardKpis = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.json(await DashboardService.getKpis(requireUserId(req)));
});

export const getEarningsOverTime = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.json(await DashboardService.getEarningsOverTime(requireUserId(req), req.query));
});

export const getServicesByCategory = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await DashboardService.getServicesByCategory(requireUserId(req), req.query));
  },
);

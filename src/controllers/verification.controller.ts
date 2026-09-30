import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as Identity from "../services/verification/identity.service";
import * as Mfa from "../services/auth/mfa.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

export const VerificationController = {
  getStatus: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await Identity.getStatus(requireUserId(req)));
  }),

  createUploadUrl: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await Identity.createUploadUrl(requireUserId(req), req.body ?? {}));
  }),

  submitIdentity: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.status(201).json(await Identity.submitIdentity(requireUserId(req), req.body ?? {}));
  }),

  requestEnableMfa: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await Mfa.requestEnableMfa(requireUserId(req)));
  }),

  confirmEnableMfa: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await Mfa.confirmEnableMfa(requireUserId(req), req.body ?? {}));
  }),

  disableMfa: asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await Mfa.disableMfa(requireUserId(req), req.body ?? {}));
  }),
};

import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import * as RegistrationService from "../services/auth/registration.service";

/** Cadastro com confirmacao de e-mail: controllers finos. */
export const AuthController = {
  handleRegister: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await RegistrationService.startRegistration(req.body ?? {}));
  }),

  handleVerifyCode: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await RegistrationService.verifyRegistration(req, req.body ?? {}));
  }),

  handleResendCode: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await RegistrationService.resendCode(req.body ?? {}));
  }),
};

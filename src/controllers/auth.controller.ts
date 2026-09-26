import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import * as RegistrationService from "../services/auth/registration.service";
import * as PasswordResetService from "../services/auth/passwordReset.service";

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

  handleForgotPassword: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await PasswordResetService.requestPasswordReset(req.body ?? {}));
  }),

  handleResetPassword: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await PasswordResetService.resetPassword(req.body ?? {}));
  }),
};

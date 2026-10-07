import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";

const authRouter = Router();

authRouter.post("/register", AuthController.handleRegister);

authRouter.post("/verify", AuthController.handleVerifyCode);

authRouter.post("/resend", AuthController.handleResendCode);

authRouter.post("/forgot-password", AuthController.handleForgotPassword);

authRouter.post("/reset-password", AuthController.handleResetPassword);

authRouter.post("/mfa/verify", AuthController.handleMfaVerify);
authRouter.post("/mfa/resend", AuthController.handleMfaResend);

export default authRouter;

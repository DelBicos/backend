import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import { VerificationController as C } from "../controllers/verification.controller";

const router = Router();

// Situacao da conta: e-mail, MFA e pedido de identidade.
router.get("/status", authMiddleware, C.getStatus);

// Verificacao em duas etapas por e-mail.
router.post("/mfa/enable", authMiddleware, C.requestEnableMfa);
router.post("/mfa/confirm", authMiddleware, C.confirmEnableMfa);
router.post("/mfa/disable", authMiddleware, C.disableMfa);

// Identidade do profissional: URL assinada por arquivo e envio do pedido.
router.post("/identity/upload-url", authMiddleware, C.createUploadUrl);
router.post("/identity", authMiddleware, C.submitIdentity);

export default router;

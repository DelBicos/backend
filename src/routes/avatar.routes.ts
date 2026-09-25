import { Router } from "express";
import adminAuth from "../middlewares/admin.middleware";
import { AvatarController } from "../controllers/avatar.controller"; 
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();

/**
 * Rotas de Gerenciamento de Arquivos e Avatar (S3 + Neon)
 */

// Listar arquivos no bucket (útil para debug)
router.get("/files", adminAuth, AvatarController.listFiles);

// Obter URL de visualização de qualquer arquivo no S3
router.get("/files/:key", authMiddleware, AvatarController.getFileUrl);

// 1. Gera a URL assinada para o Frontend fazer o PUT direto no S3
router.post("/upload-url", authMiddleware, AvatarController.getPresignedUrl);

// 2. Busca o avatar_uri atual do usuário no Neon
router.get("/:id", authMiddleware, AvatarController.getUserAvatar);

// 3. Atualiza o campo avatar_uri no Neon após o upload bem sucedido
router.patch("/update-path", authMiddleware, AvatarController.updateAvatarDatabase);

export default router;
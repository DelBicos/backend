import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import { getUploadUrl } from "../controllers/upload.controller";

const router = Router();

/**
 * @swagger
 * /uploads:
 *   post:
 *     summary: Gera URL temporária (SAS) para upload direto no Azure Blob Storage
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileName
 *               - fileType
 *             properties:
 *               fileName:
 *                 type: string
 *               fileType:
 *                 type: string
 *     responses:
 *       200:
 *         description: URLs geradas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uploadUrl:
 *                   type: string
 *                   description: URL para fazer PUT com o arquivo binário
 *                 url:
 *                   type: string
 *                   description: URL pública do arquivo após upload
 */
router.post("/", authMiddleware, getUploadUrl);

export default router;

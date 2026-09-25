import { Router } from "express";
import adminAuth from "../middlewares/admin.middleware";
import { testEmailFallback } from "../controllers/email.controller";

const emailRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Utilities
 *   description: Endpoints auxiliares para testes e manutencao
 */

/**
 * @swagger
 * /utilities/test-email-fallback:
 *   post:
 *     summary: Testa envio de e-mail via fallback Lambda (somente development)
 *     tags: [Utilities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - body
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: E-mail encaminhado para Lambda com sucesso
 *       400:
 *         description: Body invalido
 *       404:
 *         description: Endpoint indisponivel fora de development
 *       502:
 *         description: Falha na invocacao da Lambda
 *       500:
 *         description: Erro interno
 */
// Apenas administradores (e somente em development): evita relay aberto de e-mail.
emailRouter.post("/test-email-fallback", adminAuth, testEmailFallback);

export default emailRouter;

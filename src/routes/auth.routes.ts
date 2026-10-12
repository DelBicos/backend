import { Router } from "express";
import { handleRegister, handleVerifyCode, handleResendCode } from "../controllers/auth.controller";

const authRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Fluxo de cadastro e verificacao por codigo
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AuthRegisterRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - password
 *         - cpf
 *         - address
 *       properties:
 *         name:
 *           type: string
 *         surname:
 *           type: string
 *         birthDate:
 *           type: string
 *           format: date
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 6
 *         cpf:
 *           type: string
 *         address:
 *           type: object
 *           required:
 *             - postal_code
 *             - street
 *             - number
 *           properties:
 *             postal_code:
 *               type: string
 *             street:
 *               type: string
 *             number:
 *               type: string
 *             complement:
 *               type: string
 *             neighborhood:
 *               type: string
 *             city:
 *               type: string
 *             state:
 *               type: string
 *             country_iso:
 *               type: string
 *               default: BR
 *     AuthVerifyRequest:
 *       type: object
 *       required:
 *         - email
 *         - code
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         code:
 *           type: string
 *     AuthResendRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *     AuthVerifySuccessResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         token:
 *           type: string
 *         user:
 *           type: object
 *           description: Payload de usuario retornado pelo login
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Inicia cadastro e envia codigo de verificacao por e-mail
 *     tags: [Authentication]
 *     servers:
 *       - url: http://localhost:3000
 *       - url: https://delbicosbackend.onrender.com
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthRegisterRequest'
 *     responses:
 *       200:
 *         description: Codigo enviado com sucesso
 *       400:
 *         description: Campos obrigatorios ausentes ou endereco incompleto
 *       409:
 *         description: E-mail ou CPF ja cadastrado
 *       500:
 *         description: Falha ao verificar ou enviar e-mail
 */

authRouter.post("/register", handleRegister);

/**
 * @swagger
 * /auth/verify:
 *   post:
 *     summary: Verifica codigo recebido e conclui criacao da conta
 *     tags: [Authentication]
 *     servers:
 *       - url: http://localhost:3000
 *       - url: https://delbicosbackend.onrender.com
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthVerifyRequest'
 *     responses:
 *       200:
 *         description: Conta verificada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthVerifySuccessResponse'
 *       400:
 *         description: Codigo invalido/expirado ou payload invalido
 *       404:
 *         description: Sessao de verificacao nao encontrada
 *       409:
 *         description: Conflito de dados unicos ao criar usuario
 *       500:
 *         description: Falha interna ao criar usuario
 */

authRouter.post("/verify", handleVerifyCode);

/**
 * @swagger
 * /auth/resend:
 *   post:
 *     summary: Reenvia novo codigo para uma sessao de cadastro em andamento
 *     tags: [Authentication]
 *     servers:
 *       - url: http://localhost:3000
 *       - url: https://delbicosbackend.onrender.com
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthResendRequest'
 *     responses:
 *       200:
 *         description: Codigo reenviado com sucesso
 *       400:
 *         description: E-mail ausente no payload
 *       404:
 *         description: Sessao de cadastro expirada
 *       500:
 *         description: Falha no envio de e-mail
 */

authRouter.post("/resend", handleResendCode);

export default authRouter;

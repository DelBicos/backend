import { Router } from "express";
import {
  createPaymentIntentController,
  confirmPaymentController,
} from "../controllers/payment.controller";
import authMiddleware from "../middlewares/auth.middleware";

// Cria uma nova instância do Router do Express
const paymentRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Integracao de pagamento e confirmacao de agendamento
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PaymentIntentRequest:
 *       type: object
 *       required:
 *         - amount
 *         - currency
 *         - professionalId
 *         - selectedTime
 *         - serviceId
 *         - addressId
 *       properties:
 *         amount:
 *           type: number
 *           description: Valor na unidade principal (ex 50.00)
 *           minimum: 0.01
 *         currency:
 *           type: string
 *           description: Codigo ISO 4217 com 3 letras
 *           example: brl
 *         professionalId:
 *           type: integer
 *         selectedTime:
 *           type: string
 *           description: Horario/data selecionado para o agendamento
 *         serviceId:
 *           type: integer
 *         addressId:
 *           type: integer
 *     PaymentIntentResponse:
 *       type: object
 *       properties:
 *         clientSecret:
 *           type: string
 *     ConfirmPaymentRequest:
 *       type: object
 *       required:
 *         - paymentIntentId
 *       properties:
 *         paymentIntentId:
 *           type: string
 *     ConfirmPaymentResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         appointment:
 *           type: object
 *           description: Agendamento criado apos confirmacao
 */

/**
 * @swagger
 * /payments/create-payment-intent:
 *   post:
 *     summary: Cria Payment Intent no Stripe
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentIntentRequest'
 *     responses:
 *       200:
 *         description: Payment Intent criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentIntentResponse'
 *       400:
 *         description: Payload invalido
 *       401:
 *         description: Usuario nao autenticado
 *       500:
 *         description: Falha ao criar Payment Intent
 */
paymentRouter.post(
  "/create-payment-intent",
  authMiddleware,
  createPaymentIntentController, // Liga a rota ao controller que criamos
);

/**
 * @swagger
 * /payments/confirm:
 *   post:
 *     summary: Confirma pagamento e cria agendamento
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConfirmPaymentRequest'
 *     responses:
 *       201:
 *         description: Pagamento confirmado e agendamento criado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConfirmPaymentResponse'
 *       400:
 *         description: paymentIntentId ausente
 *       401:
 *         description: userId ausente ou nao autenticado
 *       500:
 *         description: Falha ao confirmar pagamento
 */
paymentRouter.post(
  "/confirm",
  authMiddleware,
  confirmPaymentController, // 4. Ligue ao novo controller
);

// Exporta o router para ser usado no server.ts
export default paymentRouter;

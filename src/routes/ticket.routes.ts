import { Router } from "express";
import { TicketController } from "../controllers/ticket.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();
const ticketController = new TicketController();

/**
 * @swagger
 * /tickets:
 *   post:
 *     summary: Abre um novo chamado de suporte
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, category, priority]
 *             properties:
 *               title: { type: string, minLength: 5, maxLength: 100 }
 *               description: { type: string, minLength: 10, maxLength: 2000 }
 *               category:
 *                 type: string
 *                 enum: [AGENDAMENTO, PAGAMENTO, SERVICO, PRESTADOR, CLIENTE, SUGESTAO, OUTROS]
 *               priority:
 *                 type: string
 *                 enum: [BAIXA, MEDIA, ALTA, CRITICA]
 *               appointment_id: { type: integer, nullable: true }
 *     responses:
 *       201: { description: Chamado criado com sucesso }
 *       400: { description: Dados inválidos }
 *       403: { description: Acesso negado }
 */
router.post("/tickets", authMiddleware, ticketController.create);

export default router;
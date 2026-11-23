import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  validateCreateTicket,
  validateCreateTicketMessage,
} from "../middlewares/ticket.validation";
import {
  addTicketMessage,
  createTicket,
  listTickets,
  showTicket,
  showTicketMessages,
} from "../controllers/ticket.controller";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Tickets
 *   description: Sistema de chamados de suporte (clientes e prestadores)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TicketCategory:
 *       type: string
 *       enum: [AGENDAMENTO, PAGAMENTO, SERVICO, PRESTADOR, CLIENTE, SUGESTAO, OUTROS]
 *       description: Categoria do chamado
 *     TicketPriority:
 *       type: string
 *       enum: [BAIXA, MEDIA, ALTA, CRITICA]
 *       description: Prioridade informada por quem abre o chamado
 *     TicketStatus:
 *       type: string
 *       enum: [ABERTO, EM_ANALISE, EM_ATENDIMENTO, RESOLVIDO, FECHADO]
 *       description: Status do chamado
 *     TicketUserType:
 *       type: string
 *       enum: [CLIENTE, PRESTADOR]
 *       description: Tipo do usuário que abriu
 *     CreateTicketInput:
 *       type: object
 *       required: [title, description, category, priority]
 *       properties:
 *         title:
 *           type: string
 *           minLength: 5
 *           maxLength: 100
 *           example: Erro ao agendar serviço
 *         description:
 *           type: string
 *           minLength: 10
 *           maxLength: 2000
 *           example: Não consigo agendar um serviço de limpeza para amanhã.
 *         category:
 *           $ref: '#/components/schemas/TicketCategory'
 *         priority:
 *           $ref: '#/components/schemas/TicketPriority'
 *         appointment_short_id:
 *           type: string
 *           example: 6BDOKZ
 *           description: Código curto do agendamento (opcional)
 *     TicketResponse:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 5 }
 *         ticket_code: { type: string, example: TKT-A7F3 }
 *         title: { type: string, example: Erro ao agendar serviço }
 *         description: { type: string, example: Descrição completa }
 *         category: { $ref: '#/components/schemas/TicketCategory' }
 *         priority: { $ref: '#/components/schemas/TicketPriority' }
 *         status: { $ref: '#/components/schemas/TicketStatus' }
 *         user_type: { $ref: '#/components/schemas/TicketUserType' }
 *         appointment_id: { type: integer, nullable: true, example: 123 }
 *         created_at: { type: string, format: date-time }
 *         updated_at: { type: string, format: date-time }
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error: { type: string }
 *         details:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               field: { type: string }
 *               message: { type: string }
 */

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
 *             $ref: '#/components/schemas/CreateTicketInput'
 *     responses:
 *       201:
 *         description: Chamado aberto (status ABERTO)
 *       400:
 *         description: Dados inválidos ou agendamento não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Token inválido ou usuário administrador
 *       500:
 *         description: Erro interno
 */
router.post("/", authMiddleware, validateCreateTicket, createTicket);

/**
 * @swagger
 * /tickets:
 *   get:
 *     summary: Lista os chamados do usuário autenticado
 *     description: Retorna todos os chamados abertos pelo usuário logado (ordem decrescente por data).
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de chamados do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tickets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TicketResponse'
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro interno
 */
router.get("/", authMiddleware, listTickets);

/**
 * @swagger
 * /tickets/{id}:
 *   get:
 *     summary: Detalhes de um chamado específico
 *     description: Retorna os dados completos de um chamado. O usuário só pode ver os próprios chamados.
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do chamado
 *         example: 5
 *     responses:
 *       200:
 *         description: Detalhes do chamado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket:
 *                   $ref: '#/components/schemas/TicketResponse'
 *       400:
 *         description: ID inválido
 *       401:
 *         description: Não autenticado
 *       404:
 *         description: Chamado não encontrado ou pertence a outro usuário
 *       500:
 *         description: Erro interno
 */
router.get("/:id", authMiddleware, showTicket);

/**
 * @swagger
 * /tickets/{id}/messages:
 *   get:
 *     summary: Lista o histórico de interações do chamado
 *     description: |
 *       Retorna todas as mensagens trocadas no chamado, em ordem cronológica.
 *       O usuário só pode ver as mensagens dos próprios chamados.
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do chamado
 *         example: 42
 *     responses:
 *       200:
 *         description: Lista de mensagens do chamado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, example: 1 }
 *                       ticket_id: { type: integer, example: 42 }
 *                       author:
 *                         type: object
 *                         properties:
 *                           id: { type: integer, example: 31 }
 *                           type:
 *                             type: string
 *                             enum: [CLIENTE, PRESTADOR, ADMIN]
 *                             example: CLIENTE
 *                           name: { type: string, example: "Douglas Wenzel" }
 *                           avatar_uri:
 *                             type: string
 *                             nullable: true
 *                             example: "https://.../avatar.jpg"
 *                       content: { type: string, example: "Alguma observação sobre o chamado." }
 *                       attachment_url:
 *                         type: string
 *                         nullable: true
 *                         example: null
 *                       created_at: { type: string, format: date-time }
 *       400:
 *         description: ID inválido
 *       401:
 *         description: Não autenticado
 *       404:
 *         description: Chamado não encontrado ou de outro usuário
 *       500:
 *         description: Erro interno
 */
router.get("/:id/messages", authMiddleware, showTicketMessages);

/**
 * @swagger
 * /tickets/{id}/messages:
 *   post:
 *     summary: Adiciona uma mensagem a um chamado aberto (TICKET-05)
 *     description: |
 *       Só o dono do chamado pode escrever. Chamados RESOLVIDO ou FECHADO não
 *       aceitam novas mensagens (409, code TICKET_CLOSED). O autor vem do token.
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do chamado
 *         example: 42
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "O prestador ainda não respondeu."
 *     responses:
 *       201:
 *         description: Mensagem adicionada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Mensagem adicionada com sucesso." }
 *                 ticket_message:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 3 }
 *                     ticket_id: { type: integer, example: 42 }
 *                     author:
 *                       type: object
 *                       properties:
 *                         id: { type: integer, example: 31 }
 *                         type: { type: string, enum: [CLIENTE, PRESTADOR, ADMIN] }
 *                         name: { type: string, example: "Maria Souza" }
 *                         avatar_uri: { type: string, nullable: true }
 *                     content: { type: string }
 *                     attachment_url: { type: string, nullable: true }
 *                     created_at: { type: string, format: date-time }
 *       400:
 *         description: ID inválido ou mensagem vazia/longa
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Token inválido
 *       404:
 *         description: Chamado não encontrado ou de outro usuário
 *       409:
 *         description: Chamado encerrado (RESOLVIDO ou FECHADO), code TICKET_CLOSED
 *       500:
 *         description: Erro interno
 */
router.post("/:id/messages", authMiddleware, validateCreateTicketMessage, addTicketMessage);

export default router;
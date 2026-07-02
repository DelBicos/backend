import { Router } from "express";
import rateLimit from "express-rate-limit";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getChatMessages,
  getChatRooms,
} from "../controllers/chat.controller";
import {
  sendBotMessage,
  getBotSession,
} from "../controllers/botChat.controller";

/**
 * Rate limiter exclusivo para o endpoint do chatbot.
 * Limite: 30 mensagens por minuto por usuário autenticado.
 * Keyed pelo user ID (req.user.id) para isolar por conta, não por IP.
 */
const botMessageRateLimit = rateLimit({
  windowMs: 60 * 1000,           // janela de 1 minuto
  max: 30,                        // máx 30 mensagens/min por usuário
  keyGenerator: (req: any) => String(req.user?.id ?? req.ip),
  standardHeaders: true,          // expõe RateLimit-* headers
  legacyHeaders: false,
  message: { error: "Muitas mensagens enviadas. Aguarde um momento antes de continuar." },
  skipFailedRequests: false,
});

const chatRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Conversas e mensagens do chat
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatRoomParticipant:
 *       type: object
 *       nullable: true
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         avatar_uri:
 *           type: string
 *           nullable: true
 *     ChatLastMessage:
 *       type: object
 *       nullable: true
 *       properties:
 *         id:
 *           type: string
 *           description: ID da mensagem no MongoDB
 *         room_id:
 *           type: integer
 *         sender_id:
 *           type: integer
 *         content:
 *           type: string
 *         sent_at:
 *           type: string
 *           format: date-time
 *     ChatRoom:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         appointment_id:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [active, archived, blocked]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         other_participant:
 *           $ref: '#/components/schemas/ChatRoomParticipant'
 *         last_message:
 *           $ref: '#/components/schemas/ChatLastMessage'
 *     ChatMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: ID da mensagem no MongoDB
 *         room_id:
 *           type: integer
 *         sender_id:
 *           type: integer
 *         content:
 *           type: string
 *         sent_at:
 *           type: string
 *           format: date-time
 *     ChatMessagesResponse:
 *       type: object
 *       properties:
 *         room_id:
 *           type: integer
 *         cursor:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Cursor para próxima paginação
 *         has_more:
 *           type: boolean
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 *         room_status:
 *           type: string
 *           enum: [active, archived, blocked]
 *         role:
 *           type: string
 *           enum: [client, professional]
 */

/**
 * @swagger
 * /chat/rooms:
 *   get:
 *     summary: Lista conversas do usuário autenticado
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Limite de salas retornadas por chamada
 *     responses:
 *       200:
 *         description: Lista de salas com correspondente e última mensagem
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ChatRoom'
 *       401:
 *         description: Usuário não autenticado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Erro interno ao listar salas
 */

/**
 * @swagger
 * /chat/rooms/{roomId}/messages:
 *   get:
 *     summary: Histórico paginado de mensagens por sala
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da sala de chat
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Cursor em ISO date (sent_at) para paginação
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Quantidade de mensagens retornadas
 *     responses:
 *       200:
 *         description: Histórico paginado de mensagens
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatMessagesResponse'
 *       400:
 *         description: ID da sala inválido
 *       401:
 *         description: Usuário não autenticado
 *       403:
 *         description: Usuário não participa da conversa
 *       503:
 *         description: Serviço de chat indisponível
 *       500:
 *         description: Erro interno ao buscar histórico
 */

/**
 * @route   GET /api/chat/rooms
 * @desc    Lista as conversas do usuário (correspondente + última mensagem)
 * @access  Private
 */
chatRouter.get("/rooms", authMiddleware, getChatRooms);

/**
 * @route   GET /api/chat/rooms/:roomId/messages
 * @desc    Histórico paginado por cursor (sent_at)
 * @access  Private
 * @query   cursor (ISO date), limit (1..50)
 */
chatRouter.get("/rooms/:roomId/messages", authMiddleware, getChatMessages);

// ── Chatbot com NLU ──────────────────────────────────────────────────────────

/**
 * @route   POST /api/chat/bot/message
 * @desc    Envia mensagem ao chatbot e recebe resposta + estado da sessão
 * @access  Private
 * @body    { message: string, session_id?: number, channel?: string }
 */
chatRouter.post("/bot/message", authMiddleware, botMessageRateLimit, sendBotMessage as any);

/**
 * @route   GET /api/chat/bot/session/:id
 * @desc    Retorna o histórico completo de uma sessão de chatbot
 * @access  Private
 */
chatRouter.get("/bot/session/:id", authMiddleware, getBotSession as any);

export default chatRouter;

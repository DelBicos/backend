import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import authMiddleware from "../middlewares/auth.middleware";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import {
  getChatMessages,
  getChatRooms,
} from "../controllers/chat.controller";
import {
  sendBotMessage,
  getBotSession,
  getActiveBotSession,
  getBotAppointmentStatus,
} from "../controllers/botChat.controller";

import { asHandler } from "../utils/asHandler";
/**
 * Rate limiter exclusivo para o endpoint do chatbot.
 * Limite: 30 mensagens por minuto por usuário autenticado.
 * Keyed pelo user ID (req.user.id) para isolar por conta, não por IP.
 */
const botMessageRateLimit = rateLimit({
  windowMs: 60 * 1000, // janela de 1 minuto
  max: 30, // máx 30 mensagens/min por usuário
  keyGenerator: (req) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    return userId != null
      ? `user:${userId}`
      : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  standardHeaders: true, // expõe RateLimit-* headers
  legacyHeaders: false,
  message: {
    error: "Muitas mensagens enviadas. Aguarde um momento antes de continuar.",
  },
  skipFailedRequests: false,
});

const chatRouter = Router();

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
chatRouter.post(
  "/bot/message",
  authMiddleware,
  botMessageRateLimit,
  asHandler(sendBotMessage),
);

/**
 * @route   GET /api/chat/bot/session/:id
 * @desc    Retorna o histórico completo de uma sessão de chatbot
 * @access  Private
 */
chatRouter.get(
  "/bot/session/active",
  authMiddleware,
  asHandler(getActiveBotSession),
);
chatRouter.get(
  "/bot/appointments/:id/status",
  authMiddleware,
  asHandler(getBotAppointmentStatus),
);
chatRouter.get("/bot/session/:id", authMiddleware, asHandler(getBotSession));

export default chatRouter;

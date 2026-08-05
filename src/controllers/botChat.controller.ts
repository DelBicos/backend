import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import {
  processMessage,
  getSessionHistory,
  getActiveSessionHistory,
} from "../services/botConversation.service";
import logger, { logError } from "../utils/logger";
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import {
  getAppointmentPaymentStatus,
  getAppointmentStatusMessage,
} from "../services/botAppointmentStatus.helpers";

/**
 * POST /api/chat/bot/message
 *
 * Body:
 *   { message: string, session_id?: number, channel?: string }
 *
 * Response:
 *   { session_id, message, state, context, clear_history }
 */
export const sendBotMessage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  const { message, session_id, channel, selected_time, timezone } = req.body as {
    message?: unknown;
    session_id?: unknown;
    channel?: unknown;
    selected_time?: unknown;
    timezone?: unknown;
  };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "O campo 'message' é obrigatório e não pode estar vazio" });
  }
  // Remove caracteres de controle (exceto \n e \t) para evitar dados malformados no banco ou classificador.
  const cleanMessage = message.replace(/[^\P{C}\n\t]/gu, "").trim();
  if (cleanMessage.length === 0) {
    return res.status(400).json({ error: "Mensagem contém apenas caracteres inválidos" });
  }
  if (cleanMessage.length > 2000) {
    return res.status(400).json({ error: "Mensagem muito longa (máx. 2000 caracteres)" });
  }

  const sessionId = session_id != null ? Number(session_id) : undefined;
  if (session_id != null && (isNaN(sessionId!) || sessionId! <= 0)) {
    return res.status(400).json({ error: "session_id inválido" });
  }

  const channelStr = typeof channel === "string" ? channel.slice(0, 50) : "web";
  const selectedTimeIso =
    typeof selected_time === "string" && selected_time.trim().length > 0
      ? selected_time.trim()
      : undefined;

  try {
    const result = await processMessage(
      req.user.id,
      req.authSessionId,
      cleanMessage,
      sessionId,
      channelStr,
      selectedTimeIso,
      typeof timezone === "string" ? timezone : undefined,
    );

    logger.info("Bot: mensagem processada", {
      userId: req.user.id,
      sessionId: result.sessionId,
      state: result.state,
    });

    return res.json({
      session_id: result.sessionId,
      message: result.message,
      state: result.state,
      context: result.context,
      clear_history: result.clearHistory === true,
    });
  } catch (error: any) {
    logError("Bot: erro ao processar mensagem", error, {
      userId: req.user.id,
      sessionId,
    });
    if (error.message?.includes("Sessão não encontrada")) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno ao processar mensagem" });
  }
};

/**
 * GET /api/chat/bot/session/:id
 *
 * Retorna o histórico completo de uma sessão de chatbot.
 */
export const getBotSession = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: "ID de sessão inválido" });
  }

  try {
    const history = await getSessionHistory(sessionId, req.user.id);
    res.setHeader("Cache-Control", "no-store");
    return res.json(history);
  } catch (error: any) {
    logError("Bot: erro ao buscar sessão", error, {
      userId: req.user.id,
      sessionId,
    });
    if (error.message?.includes("não encontrada")) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno ao buscar sessão" });
  }
};

/**
 * GET /api/chat/bot/session/active
 * Restores the latest conversation that belongs to the authenticated user.
 */
export const getActiveBotSession = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  try {
    const history = await getActiveSessionHistory(req.user.id);
    res.setHeader("Cache-Control", "no-store");
    return res.json(history);
  } catch (error) {
    logError("Bot: erro ao buscar sessão ativa", error, { userId: req.user.id });
    return res.status(500).json({ error: "Erro interno ao buscar sessão ativa" });
  }
};

/** Lightweight polling fallback when the realtime socket is unavailable. */
export const getBotAppointmentStatus = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usu\u00e1rio n\u00e3o autenticado" });
  }

  const appointmentId = Number(req.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: "ID de agendamento inv\u00e1lido" });
  }

  const client = await ClientModel.findOne({ where: { user_id: req.user.id } });
  const appointment = client
    ? await AppointmentModel.findOne({
        where: { id: appointmentId, client_id: client.id },
        attributes: ["id", "status", "payment_intent_id", "updatedAt"],
      })
    : null;

  if (!appointment) {
    return res.status(404).json({ error: "Agendamento n\u00e3o encontrado" });
  }

  const paid = Boolean(appointment.payment_intent_id);
  const paymentStatus = getAppointmentPaymentStatus(appointment);
  const pollAfterMs =
    appointment.status === "pending"
      ? 5000
      : appointment.status === "confirmed" && !paid
        ? 10000
        : null;
  res.setHeader("Cache-Control", "no-store");
  if (pollAfterMs) res.setHeader("Retry-After", "5");

  return res.json({
    appointment_id: appointment.id,
    status: appointment.status,
    message: getAppointmentStatusMessage(appointment.status, paid),
    waiting_for_professional: appointment.status === "pending",
    payment_status: paymentStatus,
    payment_pending: paymentStatus === "pending",
    paid,
    poll_after_ms: pollAfterMs,
    updated_at: appointment.updatedAt,
  });
};

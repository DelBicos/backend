import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import {
  assertParticipant,
  ChatMongoUnavailableError,
  getMessages,
  listRooms,
} from "../services/chat.service";
import { logError } from "../utils/logger";

/**
 * GET /api/chat/rooms
 * Lista as salas de chat do usuário autenticado (nome, avatar e última mensagem).
 */
export const getChatRooms = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

    const rooms = await listRooms(req.user.id, { limit });
    return res.json(rooms);
  } catch (error) {
    logError("Erro ao listar salas de chat", error);
    return res.status(500).json({ error: "Erro ao listar salas de chat" });
  }
};

/**
 * GET /api/chat/rooms/:roomId/messages?cursor=<ISO>&limit=20
 * Histórico paginado por cursor (sent_at), mais recentes primeiro.
 */
export const getChatMessages = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const roomId = Number(req.params.roomId);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: "ID da sala inválido" });
    }

    const participant = await assertParticipant(roomId, req.user.id);
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Você não participa desta conversa" });
    }

    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50
        ? limitRaw
        : 20;

    const result = await getMessages(roomId, cursor, limit);
    return res.json({
      ...result,
      room_status: participant.room.status,
      role: participant.role,
    });
  } catch (error) {
    if (error instanceof ChatMongoUnavailableError) {
      return res.status(503).json({ error: error.message });
    }
    logError("Erro ao buscar histórico do chat", error);
    return res.status(500).json({ error: "Erro ao buscar histórico do chat" });
  }
};

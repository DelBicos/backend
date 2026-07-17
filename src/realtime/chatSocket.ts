import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { ITokenPayload } from "../interfaces/authentication.interface";
import {
  assertParticipant,
  ChatMongoUnavailableError,
  persistMessage,
} from "../services/chat.service";
import logger from "../utils/logger";

interface AuthedSocket extends Socket {
  userId?: number;
}

interface SendMessagePayload {
  roomId: number;
  clientMessageUuid: string;
  text: string;
  sentAt: string;
}

const roomChannel = (roomId: number) => `room:${roomId}`;
const userChannel = (userId: number) => `user:${userId}`;

export interface AppointmentStatusSocketPayload {
  appointment_id: number;
  status: "pending" | "confirmed" | "completed" | "canceled";
  session_ids: number[];
  message: string;
  updated_at: string;
}

const parseOrigins = (): string[] | boolean => {
  const raw = process.env.ALLOWED_ORIGINS || "";
  const origins = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : true;
};

let io: Server | null = null;

export function initChatSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: parseOrigins(),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Autenticação via JWT no handshake
  io.use((socket: AuthedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Token JWT ausente"));
      }

      const decoded = jwt.verify(
        token,
        process.env.SECRET_KEY || "secret"
      ) as ITokenPayload;

      socket.userId = decoded.user.id;
      return next();
    } catch (error) {
      return next(new Error("Token inválido"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    logger.info("Socket conectado", { userId: socket.userId, id: socket.id });

    if (socket.userId) {
      socket.join(userChannel(socket.userId));
    }

    // Entrar numa sala (valida participação)
    socket.on("room:join", async (roomId: number, ack?: (resp: any) => void) => {
      try {
        if (!socket.userId) return ack?.({ ok: false, error: "Não autenticado" });

        const participant = await assertParticipant(
          Number(roomId),
          socket.userId
        );
        if (!participant) {
          return ack?.({ ok: false, error: "Você não participa desta conversa" });
        }

        socket.join(roomChannel(Number(roomId)));
        return ack?.({
          ok: true,
          role: participant.role,
          status: participant.room.status,
        });
      } catch (error) {
        logger.error("Erro em room:join", { error });
        return ack?.({ ok: false, error: "Erro ao entrar na sala" });
      }
    });

    socket.on("room:leave", (roomId: number) => {
      socket.leave(roomChannel(Number(roomId)));
    });

    // Enviar mensagem
    socket.on(
      "message:send",
      async (payload: SendMessagePayload, ack?: (resp: any) => void) => {
        try {
          if (!socket.userId)
            return ack?.({ ok: false, error: "Não autenticado" });

          const roomId = Number(payload?.roomId);
          const { clientMessageUuid, text } = payload || ({} as SendMessagePayload);

          if (!roomId || !clientMessageUuid || !text?.trim()) {
            return ack?.({ ok: false, error: "Payload inválido" });
          }

          const participant = await assertParticipant(roomId, socket.userId);
          if (!participant) {
            return ack?.({
              ok: false,
              error: "Você não participa desta conversa",
            });
          }

          if (participant.room.status === "archived") {
            return ack?.({
              ok: false,
              error: "Esta conversa está arquivada e não aceita novas mensagens",
            });
          }

          const sentAt = payload.sentAt ? new Date(payload.sentAt) : new Date();

          const { message, isNew } = await persistMessage({
            roomId,
            clientMessageUuid,
            senderUserId: socket.userId,
            senderRole: participant.role,
            text: text.trim(),
            sentAt: isNaN(sentAt.getTime()) ? new Date() : sentAt,
          });

          // Emite para todos na sala (inclui o remetente para reconciliar o otimista)
          if (io) {
            io.to(roomChannel(roomId)).emit("message:new", message);
          }

          return ack?.({ ok: true, message, duplicated: !isNew });
        } catch (error) {
          const message =
            error instanceof ChatMongoUnavailableError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Erro ao enviar mensagem";
          logger.error("Erro em message:send", {
            message,
            stack: error instanceof Error ? error.stack : undefined,
          });
          return ack?.({ ok: false, error: message });
        }
      }
    );

    socket.on("disconnect", () => {
      logger.info("Socket desconectado", { userId: socket.userId, id: socket.id });
    });
  });

  return io;
}

export function getChatSocket(): Server | null {
  return io;
}

/** Pushes appointment changes to every open device of the same user. */
export function emitAppointmentStatusUpdate(
  userId: number,
  payload: AppointmentStatusSocketPayload,
): void {
  io?.to(userChannel(userId)).emit("appointment:status", payload);
}

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
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import { UserModel } from "../models/User";

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

async function assertAppointmentParticipant(
  appointmentId: number,
  userId: number
): Promise<{
  appointment: AppointmentModel;
  role: "client" | "professional";
  clientUserId?: number;
  profUserId?: number;
  profConsentAccepted: boolean;
} | null> {
  if (!appointmentId || !userId || isNaN(Number(appointmentId))) return null;

  const appointment = await AppointmentModel.findByPk(Number(appointmentId), {
    include: [
      {
        model: ClientModel,
        as: "Client",
        include: [{ model: UserModel, as: "User", attributes: ["id", "location_consent_accepted"] }],
      },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["id", "location_consent_accepted"] }],
      },
    ],
  });

  if (!appointment) return null;

  const clientUser = (appointment as any).Client?.User;
  const profUser = (appointment as any).Professional?.User;
  const clientUserId = clientUser?.id;
  const profUserId = profUser?.id;

  if (userId !== clientUserId && userId !== profUserId) {
    return null;
  }

  const role: "client" | "professional" = userId === clientUserId ? "client" : "professional";
  const profConsentAccepted = Boolean(profUser?.location_consent_accepted);

  return { appointment, role, clientUserId, profUserId, profConsentAccepted };
}

export interface AppointmentStatusSocketPayload {
  appointment_id: number;
  status: "pending" | "confirmed" | "completed" | "canceled" | "in_transit" | "arrived" | "in_progress" | string;
  verification_code?: string;
  session_ids: number[];
  message: string;
  payment_status: "not_available" | "pending" | "paid" | string;
  payment_pending: boolean;
  paid: boolean;
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

    // Entrar na sala de acompanhamento do agendamento (valida autorização de participante)
    socket.on("appointment:join", async (appointmentId: number, ack?: (resp: any) => void) => {
      try {
        if (!socket.userId || !appointmentId) return ack?.({ ok: false, error: "Não autenticado ou ID inválido" });
        const participant = await assertAppointmentParticipant(appointmentId, socket.userId);
        if (!participant) {
          return ack?.({ ok: false, error: "Acesso negado ao agendamento" });
        }
        socket.join(`appointment:${appointmentId}`);
        return ack?.({ ok: true });
      } catch (error) {
        logger.error("Erro em appointment:join", { error });
        return ack?.({ ok: false, error: "Erro ao entrar na sala do agendamento" });
      }
    });

    // Set em memória para rastrear agendamentos que já receberam o alerta de 5 minutos
    const notifiedProximityAppointments = new Set<number>();

    // Enviar atualização de localização do prestador em tempo real
    socket.on("location:send", async (payload: { appointment_id: number; client_user_id?: number; dest_lat?: number; dest_lng?: number; latitude: number; longitude: number; heading?: number; speed?: number }) => {
      try {
        if (!socket.userId || !payload?.appointment_id) return;

        const participant = await assertAppointmentParticipant(payload.appointment_id, socket.userId);
        if (!participant) return;

        // Apenas o profissional do agendamento pode transmitir sua localização
        if (participant.role !== "professional") return;

        // O agendamento deve estar em deslocamento ("in_transit") ou chegado ("arrived")
        if (participant.appointment.status !== "in_transit" && participant.appointment.status !== "arrived") return;

        // Validação de consentimento LGPD do prestador
        if (!participant.profConsentAccepted) return;

        const updatePayload = {
          appointment_id: payload.appointment_id,
          latitude: payload.latitude,
          longitude: payload.longitude,
          heading: payload.heading || 0,
          speed: payload.speed || 0,
          timestamp: new Date().toISOString(),
        };

        if (io) {
          io.to(`appointment:${payload.appointment_id}`).emit("location:update", updatePayload);
          if (participant.clientUserId) {
            io.to(userChannel(participant.clientUserId)).emit("location:update", updatePayload);
          }

          // Checagem da Notificação de Proximidade (~5 minutos)
          if (payload.dest_lat && payload.dest_lng && !notifiedProximityAppointments.has(payload.appointment_id)) {
            const R = 6371000;
            const radLat1 = (payload.latitude * Math.PI) / 180;
            const radLat2 = (payload.dest_lat * Math.PI) / 180;
            const dLat = ((payload.dest_lat - payload.latitude) * Math.PI) / 180;
            const dLon = ((payload.dest_lng - payload.longitude) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(radLat1) * Math.cos(radLat2) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distMeters = Math.round(R * c);
            const estMinutes = Math.max(1, Math.ceil(distMeters / 300));

            if (estMinutes <= 5 || distMeters <= 2500) {
              notifiedProximityAppointments.add(payload.appointment_id);
              const proximityPayload = {
                appointment_id: payload.appointment_id,
                message: "🚘 O prestador está a cerca de 5 minutos da sua casa! Fique atento.",
                estimated_minutes: estMinutes,
                distance_meters: distMeters,
              };
              io.to(`appointment:${payload.appointment_id}`).emit("location:proximity_warning", proximityPayload);
              if (participant.clientUserId) {
                io.to(userChannel(participant.clientUserId)).emit("location:proximity_warning", proximityPayload);
              }
            }
          }
        }
      } catch (error) {
        logger.error("Erro em location:send", { error });
      }
    });

    // Enviar evento de encerramento do rastreamento (Cheguei no Local)
    socket.on("location:arrived", async (payload: { appointment_id: number; client_user_id?: number }) => {
      try {
        if (!socket.userId || !payload?.appointment_id) return;

        const participant = await assertAppointmentParticipant(payload.appointment_id, socket.userId);
        if (!participant) return;

        if (participant.role !== "professional") return;

        if (participant.appointment.status !== "in_transit" && participant.appointment.status !== "arrived") return;

        const arrivedPayload = {
          appointment_id: payload.appointment_id,
          message: "🎯 Prestador no local (Rastreamento encerrado)",
          timestamp: new Date().toISOString(),
        };

        if (io) {
          io.to(`appointment:${payload.appointment_id}`).emit("location:arrived", arrivedPayload);
          if (participant.clientUserId) {
            io.to(userChannel(participant.clientUserId)).emit("location:arrived", arrivedPayload);
          }
        }
      } catch (error) {
        logger.error("Erro em location:arrived", { error });
      }
    });

    socket.on("disconnect", () => {
      logger.info("Socket desconectado", { userId: socket.userId, id: socket.id });
    });
  });

  return io;
}

export function getChatSocket(): Server | null {
  return io;
}

export interface LocationUpdatePayload {
  appointment_id: number;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp: string;
}

export function emitLocationUpdate(
  targetUserId: number,
  payload: LocationUpdatePayload,
): void {
  io?.to(userChannel(targetUserId)).emit("location:update", payload);
  io?.to(`appointment:${payload.appointment_id}`).emit("location:update", payload);
}

/** Pushes appointment changes to every open device of the same user. */
export function emitAppointmentStatusUpdate(
  userId: number,
  payload: AppointmentStatusSocketPayload,
): void {
  io?.to(userChannel(userId)).emit("appointment:status", payload);
}

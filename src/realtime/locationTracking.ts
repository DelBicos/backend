import type { Server, Socket } from "socket.io";
import { calculateDistanceInMeters } from "../services/appointment/checkin.rules";
import { findTrackingParticipant } from "../services/appointment/checkin.service";
import logger from "../utils/logger";

/**
 * Rastreamento do profissional durante o deslocamento até o cliente.
 * O profissional envia a posição; o cliente do agendamento recebe em tempo real.
 */

interface TrackingSocket extends Socket {
  userId?: number;
}

type SocketAck = (resp: { ok: boolean; [key: string]: unknown }) => void;

interface LocationSendPayload {
  appointment_id: number;
  dest_lat?: number;
  dest_lng?: number;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

export interface LocationUpdatePayload {
  appointment_id: number;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  timestamp: string;
}

/** Distância a partir da qual o cliente recebe o aviso de "chegando". */
const PROXIMITY_DISTANCE_METERS = 2500;
/** Velocidade média urbana usada só para estimar os minutos do aviso (~18 km/h). */
const METERS_PER_MINUTE = 300;

const appointmentChannel = (appointmentId: number) => `appointment:${appointmentId}`;
const userChannel = (userId: number) => `user:${userId}`;

function emitToAppointment(io: Server, appointmentId: number, clientUserId: number | undefined, event: string, payload: unknown) {
  io.to(appointmentChannel(appointmentId)).emit(event, payload);
  if (clientUserId) io.to(userChannel(clientUserId)).emit(event, payload);
}

export function registerLocationTracking(io: Server, socket: TrackingSocket): void {
  // Agendamentos desta conexão que já receberam o aviso de proximidade.
  const proximityNotified = new Set<number>();

  socket.on("appointment:join", async (appointmentId: number, ack?: SocketAck) => {
    try {
      if (!socket.userId || !appointmentId) return ack?.({ ok: false, error: "Não autenticado ou ID inválido" });
      const participant = await findTrackingParticipant(appointmentId, socket.userId);
      if (!participant) return ack?.({ ok: false, error: "Acesso negado ao agendamento" });
      socket.join(appointmentChannel(appointmentId));
      return ack?.({ ok: true });
    } catch (error) {
      logger.error("Erro em appointment:join", { error });
      return ack?.({ ok: false, error: "Erro ao entrar na sala do agendamento" });
    }
  });

  socket.on("location:send", async (payload: LocationSendPayload) => {
    try {
      if (!socket.userId || !payload?.appointment_id) return;
      const participant = await findTrackingParticipant(payload.appointment_id, socket.userId);
      // Só o profissional do agendamento, com consentimento LGPD, em deslocamento ou no local.
      if (!participant || participant.role !== "professional" || !participant.professionalConsent) return;
      if (participant.status !== "in_transit" && participant.status !== "arrived") return;

      const update: LocationUpdatePayload = {
        appointment_id: payload.appointment_id,
        latitude: payload.latitude,
        longitude: payload.longitude,
        heading: payload.heading || 0,
        speed: payload.speed || 0,
        timestamp: new Date().toISOString(),
      };
      emitToAppointment(io, payload.appointment_id, participant.clientUserId, "location:update", update);

      if (payload.dest_lat && payload.dest_lng && !proximityNotified.has(payload.appointment_id)) {
        const distance = calculateDistanceInMeters(payload.latitude, payload.longitude, payload.dest_lat, payload.dest_lng);
        const minutes = Math.max(1, Math.ceil(distance / METERS_PER_MINUTE));
        if (minutes <= 5 || distance <= PROXIMITY_DISTANCE_METERS) {
          proximityNotified.add(payload.appointment_id);
          emitToAppointment(io, payload.appointment_id, participant.clientUserId, "location:proximity_warning", {
            appointment_id: payload.appointment_id,
            message: "O prestador está a cerca de 5 minutos. Fique atento.",
            estimated_minutes: minutes,
            distance_meters: Math.round(distance),
          });
        }
      }
    } catch (error) {
      logger.error("Erro em location:send", { error });
    }
  });

  socket.on("location:arrived", async (payload: { appointment_id: number }) => {
    try {
      if (!socket.userId || !payload?.appointment_id) return;
      const participant = await findTrackingParticipant(payload.appointment_id, socket.userId);
      if (!participant || participant.role !== "professional") return;
      if (participant.status !== "in_transit" && participant.status !== "arrived") return;
      emitToAppointment(io, payload.appointment_id, participant.clientUserId, "location:arrived", {
        appointment_id: payload.appointment_id,
        message: "Prestador no local. Rastreamento encerrado.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Erro em location:arrived", { error });
    }
  });
}

import { AppointmentModel } from "../models/Appointment";
import { BotChatSessionModel, BotSessionContext } from "../models/BotChatSession";
import { ClientModel } from "../models/Client";
import { BotState } from "../constants/botStates";
import { BotSessionManager } from "./bot/BotSessionManager";
import {
  AppointmentStatusSocketPayload,
  emitAppointmentStatusUpdate,
} from "../realtime/chatSocket";

const statusMessages = {
  pending: "O agendamento continua pendente de resposta do profissional.",
  confirmed: "\u2705 O profissional confirmou seu agendamento. Ele agora est\u00e1 confirmado.",
  canceled: "\u274c O profissional recusou ou o agendamento foi cancelado.",
  completed: "\u2705 O agendamento foi conclu\u00eddo.",
} as const;

/** Synchronizes the bot history and every connected device after a status change. */
export async function syncBotSessionsForAppointmentStatus(
  appointment: AppointmentModel,
): Promise<AppointmentStatusSocketPayload | null> {
  const client = await ClientModel.findByPk(appointment.client_id);
  if (!client) return null;

  let sessions = await BotChatSessionModel.findAll({
    where: {
      user_id: client.user_id,
      appointment_id: appointment.id,
      status: "active",
    },
    order: [["id", "DESC"]],
  });

  // Repair conversations finalized by the previous flow.
  if (sessions.length === 0) {
    const latest = await BotChatSessionModel.findOne({
      where: { user_id: client.user_id, appointment_id: appointment.id },
      order: [["id", "DESC"]],
    });
    if (latest) sessions = [latest];
  }

  const message = statusMessages[appointment.status];

  for (const session of sessions) {
    const context = (session.context ?? {}) as BotSessionContext;
    const statusChanged = context.appointmentStatus !== appointment.status;

    session.context = {
      ...context,
      appointmentId: appointment.id,
      appointmentStatus: appointment.status,
    };

    if (appointment.status === "pending") {
      session.status = "active";
      session.ended_at = null;
      session.state = BotState.AGUARDANDO_CONFIRMACAO;
    } else {
      // A status response ends the wait, but never closes the conversation.
      session.status = "active";
      session.ended_at = null;
      session.state = BotState.INICIO;
    }
    await session.save();

    if (statusChanged) {
      await BotSessionManager.createMessage(
        session.id,
        "bot",
        message,
        null,
        {
          event: "appointment_status",
          appointment_id: appointment.id,
          status: appointment.status,
        },
      );
    }
  }

  const payload: AppointmentStatusSocketPayload = {
    appointment_id: appointment.id,
    status: appointment.status,
    session_ids: sessions.map((session) => session.id),
    message,
    updated_at: appointment.updatedAt.toISOString(),
  };

  emitAppointmentStatusUpdate(client.user_id, payload);
  return payload;
}

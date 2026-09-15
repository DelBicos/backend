import { AppointmentModel } from "../models/Appointment";
import { BotChatSessionModel, BotSessionContext } from "../models/BotChatSession";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import { BotState } from "../constants/botStates";
import { BotSessionManager } from "./bot/BotSessionManager";
import {
  AppointmentStatusSocketPayload,
  emitAppointmentStatusUpdate,
} from "../realtime/chatSocket";
import {
  getAppointmentPaymentStatus,
  getAppointmentStatusMessage,
} from "./botAppointmentStatus.helpers";

/** Synchronizes the bot history and every connected device after a status change. */
export async function syncBotSessionsForAppointmentStatus(
  appointment: AppointmentModel,
): Promise<AppointmentStatusSocketPayload | null> {
  const [client, professional] = await Promise.all([
    ClientModel.findByPk(appointment.client_id),
    ProfessionalModel.findByPk(appointment.professional_id),
  ]);
  if (!client) return null;

  const sessions = await BotChatSessionModel.findAll({
    where: {
      user_id: client.user_id,
      appointment_id: appointment.id,
      status: "active",
    },
    order: [["id", "DESC"]],
  });

  const paid = Boolean(appointment.payment_intent_id);
  const paymentStatus = getAppointmentPaymentStatus(appointment);
  const message = getAppointmentStatusMessage(appointment.status, paid);

  for (const session of sessions) {
    const context = (session.context ?? {}) as BotSessionContext;
    const statusChanged =
      context.appointmentStatus !== appointment.status ||
      context.appointmentPaid !== paid;

    session.context = {
      ...context,
      appointmentId: appointment.id,
      appointmentStatus: appointment.status,
      appointmentPaid: paid,
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
    payment_status: paymentStatus,
    payment_pending: paymentStatus === "pending",
    paid,
    updated_at: appointment.updatedAt.toISOString(),
  };

  emitAppointmentStatusUpdate(client.user_id, payload);
  if (professional) emitAppointmentStatusUpdate(professional.user_id, payload);
  return payload;
}

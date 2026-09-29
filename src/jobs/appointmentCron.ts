import cron from "node-cron";
import { Op } from "sequelize";
import { AppointmentModel } from "../models/Appointment";
import { NotificationModel } from "../models/Notification";
import { ProfessionalModel } from "../models/Professional";
import { ClientModel } from "../models/Client";
import { UserModel } from "../models/User";
import { ServiceModel } from "../models/Service";
import logger, { logError } from "../utils/logger";
import { archiveChatRoomForAppointment } from "../utils/chatRoom";
import { PaymentService } from "../services/payment.service";
import { syncBotSessionsForAppointmentStatus } from "../services/botAppointmentStatus.service";
import type { AppointmentWithRelations } from "../services/appointment/appointment.types";

/** Prazo para o profissional responder a um pedido pendente. */
export const PENDING_EXPIRY_HOURS = 12;

const EXPIRY_REASON = `Sem resposta do profissional em ${PENDING_EXPIRY_HOURS} horas`;

function paymentNoteFor(settlement: string): string {
  if (settlement === "released") {
    return " A reserva no seu cartão foi liberada e nenhum valor foi cobrado.";
  }
  if (settlement === "refunded") return " O valor pago foi estornado.";
  if (settlement === "failed") return " O estorno está sendo processado.";
  return "";
}

async function notify(userId: number, message: string, appointmentId: number) {
  await NotificationModel.create({
    user_id: userId,
    title: "Agendamento Expirado",
    message,
    notification_type: "appointment",
    related_entity_id: appointmentId,
    is_read: false,
  });
}

/** Cancela um pedido sem resposta, libera a reserva do cartao e avisa as duas partes. */
async function expireAppointment(appointment: AppointmentWithRelations) {
  appointment.status = "canceled";
  appointment.canceled_by = "system";
  appointment.canceled_at = new Date();
  appointment.cancellation_reason = EXPIRY_REASON;
  appointment.retained_cents = 0;
  await appointment.save();

  // Ninguem foi cobrado (o profissional nao aceitou): libera a reserva no cartao.
  const settlement = appointment.payment_intent_id
    ? await PaymentService.settleUnusedPayment(appointment.payment_intent_id)
    : "none";

  await archiveChatRoomForAppointment(appointment.id);

  const title = appointment.Service?.title;
  const clientUser = appointment.Client?.User;
  const professionalUser = appointment.Professional?.User;
  if (clientUser) {
    await notify(
      clientUser.id,
      `O seu agendamento para '${title}' não foi aceito pelo profissional a tempo e foi cancelado automaticamente.${paymentNoteFor(settlement)}`,
      appointment.id,
    );
  }
  if (professionalUser) {
    await notify(
      professionalUser.id,
      `Você não respondeu a solicitação para '${title}' em ${PENDING_EXPIRY_HOURS} horas e ela foi cancelada automaticamente.`,
      appointment.id,
    );
  }
  await syncBotSessionsForAppointmentStatus(appointment);
}

/**
 * Expira os pedidos pendentes ha mais de PENDING_EXPIRY_HOURS. Uma falha em
 * um agendamento nao impede os demais. Retorna quantos foram expirados.
 */
export async function expirePendingAppointments(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_EXPIRY_HOURS * 60 * 60 * 1000);
  const pending = (await AppointmentModel.findAll({
    where: { status: "pending", createdAt: { [Op.lte]: cutoff } },
    include: [
      { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User" }] },
      { model: ProfessionalModel, as: "Professional", include: [{ model: UserModel, as: "User" }] },
      { model: ServiceModel, as: "Service" },
    ],
  })) as AppointmentWithRelations[];

  if (pending.length === 0) return 0;
  logger.info(`Encontrados ${pending.length} agendamentos expirados.`);

  let expired = 0;
  for (const appointment of pending) {
    try {
      await expireAppointment(appointment);
      expired += 1;
    } catch (error) {
      logError("Falha ao expirar agendamento", error, { appointmentId: appointment.id });
    }
  }
  return expired;
}

export const startAppointmentCron = () => {
  // Roda a cada 10 minutos
  cron.schedule("*/10 * * * *", async () => {
    try {
      await expirePendingAppointments();
    } catch (error) {
      logError("Erro ao executar cron job de agendamentos expirados", error);
    }
  });
};

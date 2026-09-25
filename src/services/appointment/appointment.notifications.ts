/**
 * Notificacoes in-app disparadas pelo ciclo de vida do agendamento.
 *
 * Falhas ao notificar sao registradas mas nunca desfazem a operacao de
 * negocio (o agendamento/pagamento ja foi persistido).
 */
import { NotificationModel } from "../../models/Notification";
import logger from "../../utils/logger";

const TIME_ZONE = "America/Sao_Paulo";

export function formatAppointmentDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { timeZone: TIME_ZONE });
}

export function formatAppointmentTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  });
}

async function notify(
  userId: number | undefined | null,
  title: string,
  message: string,
  appointmentId: number,
  type: "appointment" | "service" = "appointment",
): Promise<void> {
  if (!userId) return;
  try {
    await NotificationModel.create({
      user_id: userId,
      title,
      message,
      notification_type: type,
      related_entity_id: appointmentId,
      is_read: false,
    });
  } catch (error) {
    logger.warn("Falha ao criar notificação de agendamento", {
      appointmentId,
      userId,
      reason: (error as Error).message,
    });
  }
}

export interface CreatedAppointmentNotice {
  appointmentId: number;
  startTime: Date;
  serviceTitle: string;
  clientUserId?: number | null;
  clientName?: string | null;
  professionalUserId?: number | null;
}

export async function notifyAppointmentCreated(n: CreatedAppointmentNotice) {
  const date = formatAppointmentDate(n.startTime);
  const time = formatAppointmentTime(n.startTime);
  await Promise.all([
    notify(
      n.professionalUserId,
      "Novo Agendamento Recebido",
      `Você recebeu um novo agendamento de ${
        n.clientName || "Cliente Desconhecido"
      } para o serviço '${n.serviceTitle}' no dia ${date} às ${time}. Status: Pendente de Confirmação.`,
      n.appointmentId,
    ),
    notify(
      n.clientUserId,
      "Agendamento Criado com Sucesso",
      `Seu agendamento para o serviço '${n.serviceTitle}' no dia ${date} às ${time} foi criado. Aguardando confirmação do profissional.`,
      n.appointmentId,
    ),
  ]);
}

export async function notifyAppointmentAccepted(
  clientUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
) {
  await notify(
    clientUserId,
    "Seu agendamento foi aceito!",
    `O profissional aceitou seu agendamento para o serviço '${serviceTitle}'.`,
    appointmentId,
  );
}

export async function notifyAppointmentRejected(
  clientUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
  refund: "none" | "refunded" | "processing",
) {
  const refundMsg =
    refund === "refunded"
      ? " O valor do pagamento foi estornado com sucesso."
      : refund === "processing"
        ? " O estorno do pagamento está sendo processado."
        : "";
  await notify(
    clientUserId,
    "Agendamento Recusado",
    `O profissional não pôde aceitar o serviço '${serviceTitle}'.${refundMsg}`,
    appointmentId,
  );
}

export async function notifyAppointmentCompleted(
  clientUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
) {
  await notify(
    clientUserId,
    "Atendimento concluído",
    `O serviço '${serviceTitle}' foi concluído. Conte como foi avaliando o profissional em Meus Agendamentos.`,
    appointmentId,
  );
}

export async function notifyReviewReceived(
  professionalUserId: number | undefined,
  appointmentId: number,
  rating: number,
  review: string | null,
  serviceTitle?: string,
) {
  await notify(
    professionalUserId,
    "Nova Avaliação Recebida",
    `Você recebeu uma avaliação de ${rating} estrelas${
      serviceTitle ? ` para o serviço '${serviceTitle}'` : ""
    }${review ? `: "${review}"` : "."}`,
    appointmentId,
    "service",
  );
}

export async function notifyPaymentConfirmed(
  clientUserId: number,
  appointmentId: number,
  serviceTitle: string,
  startTime: Date,
) {
  await notify(
    clientUserId,
    "Pagamento Confirmado",
    `O pagamento para o seu agendamento do serviço '${serviceTitle}' no dia ${formatAppointmentDate(
      startTime,
    )} às ${formatAppointmentTime(startTime)} foi confirmado!`,
    appointmentId,
  );
}

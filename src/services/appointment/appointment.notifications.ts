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
  refund: "none" | "released" | "refunded" | "processing",
) {
  const refundMsg =
    refund === "released"
      ? " A reserva no seu cartão foi liberada e nenhum valor foi cobrado."
      : refund === "refunded"
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

const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function notifyAppointmentCanceled(params: {
  recipientUserId: number | undefined;
  canceledBy: "client" | "professional" | "system";
  serviceTitle?: string;
  appointmentId: number;
  refundedCents: number;
  retainedCents: number;
}) {
  const { canceledBy, serviceTitle, refundedCents, retainedCents } = params;
  const who =
    canceledBy === "client"
      ? "O cliente cancelou"
      : canceledBy === "professional"
        ? "O profissional cancelou"
        : "O sistema cancelou";
  const money_note =
    retainedCents > 0
      ? ` Foram retidos ${money(retainedCents)} conforme a política de cancelamento e ${money(refundedCents)} devolvidos.`
      : refundedCents > 0
        ? ` O valor de ${money(refundedCents)} foi devolvido integralmente.`
        : "";
  await notify(
    params.recipientUserId,
    "Agendamento cancelado",
    `${who} o serviço '${serviceTitle}'.${money_note}`,
    params.appointmentId,
  );
}

export async function notifyNoShow(
  clientUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
) {
  await notify(
    clientUserId,
    "Não comparecimento registrado",
    `O profissional registrou que você não compareceu ao serviço '${serviceTitle}', e o valor foi retido. Se isso não procede, abra uma disputa em até 7 dias.`,
    appointmentId,
  );
}

export async function notifyRescheduleRequested(
  recipientUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
  newStart: Date,
) {
  await notify(
    recipientUserId,
    "Pedido de reagendamento",
    `Foi pedido reagendar '${serviceTitle}' para ${formatAppointmentDate(newStart)} às ${formatAppointmentTime(newStart)}. Responda em Meus Agendamentos.`,
    appointmentId,
  );
}

export async function notifyRescheduleAnswered(
  requesterUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
  accepted: boolean,
) {
  await notify(
    requesterUserId,
    accepted ? "Reagendamento aceito" : "Reagendamento recusado",
    accepted
      ? `O novo horário de '${serviceTitle}' foi confirmado.`
      : `O pedido de reagendamento de '${serviceTitle}' foi recusado. O horário original continua valendo.`,
    appointmentId,
  );
}

export async function notifyDisputeOpened(
  professionalUserId: number | undefined,
  serviceTitle: string | undefined,
  appointmentId: number,
) {
  await notify(
    professionalUserId,
    "Disputa aberta",
    `O cliente abriu uma disputa sobre o serviço '${serviceTitle}'. A equipe DelBicos vai analisar o caso.`,
    appointmentId,
  );
}

export async function notifyDisputeResolved(params: {
  userIds: Array<number | undefined>;
  serviceTitle?: string;
  appointmentId: number;
  resolution: "refund_full" | "refund_partial" | "rejected";
  refundCents: number;
}) {
  const text =
    params.resolution === "rejected"
      ? "A disputa foi analisada e não houve alteração no valor."
      : `A disputa foi analisada e ${money(params.refundCents)} foram devolvidos ao cliente.`;
  for (const userId of params.userIds) {
    await notify(userId, "Disputa resolvida", `Serviço '${params.serviceTitle}': ${text}`, params.appointmentId);
  }
}

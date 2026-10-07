/**
 * Ciclo de vida do agendamento apos a criacao: cancelamento com politica,
 * nao comparecimento e reagendamento.
 *
 * Toda operacao que mexe em dinheiro acerta o pagamento ANTES de gravar o
 * novo status: se o Stripe falhar, o agendamento permanece como estava e o
 * usuario pode tentar de novo.
 */
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { HttpError } from "../../errors/HttpError";
import logger from "../../utils/logger";
import { syncChatRoomStatusForAppointment } from "../../utils/chatRoom";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import { PaymentService, servicePriceInCents } from "../payment.service";
import {
  assertMinimumAdvance,
  assertValidPeriod,
  type AppointmentStatus,
} from "./appointment.rules";
import {
  assertCanCancel,
  assertCanMarkNoShow,
  assertCanReschedule,
  computeCancellationOutcome,
  NO_SHOW_RETENTION_PERCENT,
  retentionFor,
  type CancelActor,
  type CancellationTier,
} from "./cancellation.rules";
import { assertSlotInAgenda, getAvailableSlots } from "../availability.service";
import {
  assertNoAppointmentOverlap,
  withProfessionalScheduleLock,
} from "../appointmentSchedule.service";
import {
  assertProfessionalIsFree,
  findAppointmentByPublicId,
  toPublicAppointment,
} from "./appointment.service";
import {
  notifyAppointmentCanceled,
  notifyNoShow,
  notifyRescheduleAnswered,
  notifyRescheduleRequested,
} from "./appointmentNotifications.service";

import { errorMessage } from "../../utils/errors.util";
import type { AppointmentWithRelations } from "./appointment.types";
const MAX_REASON_LENGTH = 500;

type LoadedAppointment = AppointmentWithRelations;

async function loadAppointment(publicId: string | number): Promise<LoadedAppointment> {
  const appointment = await findAppointmentByPublicId(publicId, {
    include: [
      { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
      { model: ProfessionalModel, as: "Professional", attributes: ["id", "user_id"] },
      { model: ServiceModel, as: "Service", attributes: ["id", "title", "duration", "price", "price_cents"] },
    ],
  });
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");
  return appointment as LoadedAppointment;
}

/** Descobre se o usuario e o cliente ou o profissional deste agendamento. */
function resolveActor(appointment: LoadedAppointment, userId: number): "client" | "professional" {
  if (appointment.Client?.user_id === userId) return "client";
  if (appointment.Professional?.user_id === userId) return "professional";
  throw HttpError.forbidden("Você não participa deste agendamento");
}

const otherPartyUserId = (appointment: LoadedAppointment, actor: "client" | "professional") =>
  actor === "client" ? appointment.Professional?.user_id : appointment.Client?.user_id;

function cleanReason(reason: unknown): string | null {
  if (reason === undefined || reason === null || reason === "") return null;
  if (typeof reason !== "string") throw HttpError.badRequest("O motivo deve ser um texto");
  const text = reason.trim();
  if (text.length > MAX_REASON_LENGTH) {
    throw HttpError.badRequest(`O motivo deve ter no máximo ${MAX_REASON_LENGTH} caracteres`);
  }
  return text || null;
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

/** Mostra ao usuario quanto custaria cancelar agora (sem cancelar). */
export async function previewCancellation(userId: number, publicId: string, now = new Date()) {
  const appointment = await loadAppointment(publicId);
  const actor = resolveActor(appointment, userId);
  assertCanCancel(appointment.status, appointment.start_time, now);

  const paidCents = appointment.payment_intent_id
    ? await PaymentService.getPaidAmountCents(appointment.payment_intent_id)
    : appointment.Service
      ? safePriceCents(appointment.Service)
      : 0;

  return computeCancellationOutcome({
    actor,
    status: appointment.status,
    start: appointment.start_time,
    paidCents,
    now,
  });
}

function safePriceCents(service: NonNullable<LoadedAppointment["Service"]>): number {
  try {
    return servicePriceInCents(service);
  } catch {
    return 0;
  }
}

/** Cliente ou profissional cancela um agendamento pendente ou confirmado. */
export async function cancelAppointment(
  userId: number,
  publicId: string,
  reason?: unknown,
  now: Date = new Date(),
) {
  const appointment = await loadAppointment(publicId);
  const actor: CancelActor = resolveActor(appointment, userId);
  assertCanCancel(appointment.status, appointment.start_time, now);
  const cleanedReason = cleanReason(reason);

  const previousStatus = appointment.status;
  const { tier, retentionPercent } = retentionFor({
    actor,
    status: previousStatus,
    start: appointment.start_time,
    now,
  });

  let retainedCents = 0;
  let refundedCents = 0;
  if (appointment.payment_intent_id) {
    const split = await PaymentService.settleWithRetention(
      appointment.payment_intent_id,
      retentionPercent,
    );
    if (split.status === "failed") {
      throw new HttpError(
        502,
        "Não foi possível processar o pagamento agora. Nada foi cancelado; tente novamente.",
      );
    }
    retainedCents = split.retainedCents;
    refundedCents = split.refundedCents;
  }

  appointment.status = "canceled";
  appointment.canceled_by = actor;
  appointment.canceled_at = now;
  appointment.cancellation_reason = cleanedReason;
  appointment.retained_cents = retainedCents;
  appointment.refunded_cents = refundedCents;
  appointment.reschedule_requested_start = null;
  appointment.reschedule_requested_by = null;
  await appointment.save();

  await syncChatRoomStatusForAppointment(appointment.id, "canceled");

  // Reputacao: o profissional que cancela um servico ja aceito leva a marca.
  if (actor === "professional" && previousStatus === "confirmed" && appointment.Professional) {
    await ProfessionalModel.increment("cancellations_count", {
      where: { id: appointment.Professional.id },
    });
  }

  await notifyAppointmentCanceled({
    recipientUserId: otherPartyUserId(appointment, actor as "client" | "professional"),
    canceledBy: actor,
    serviceTitle: appointment.Service?.title,
    appointmentId: appointment.id,
    refundedCents,
    retainedCents,
  });
  await syncBotSessionsForAppointmentStatus(appointment).catch((error: unknown) =>
    logger.warn("Falha ao sincronizar chatbot no cancelamento", { reason: errorMessage(error) }),
  );

  logger.info("Agendamento cancelado", {
    appointmentId: appointment.id,
    actor,
    tier,
    retainedCents,
    refundedCents,
  });
  return { appointment: toPublicAppointment(appointment), tier: tier as CancellationTier, retainedCents, refundedCents };
}

// ---------------------------------------------------------------------------
// Nao comparecimento
// ---------------------------------------------------------------------------

/** Profissional registra que o cliente nao compareceu: o valor fica retido. */
export async function markNoShow(userId: number, publicId: string, now: Date = new Date()) {
  const appointment = await loadAppointment(publicId);
  if (resolveActor(appointment, userId) !== "professional") {
    throw HttpError.forbidden("Apenas o profissional responsável pode registrar o não comparecimento");
  }
  if (appointment.status !== ("confirmed" as AppointmentStatus)) {
    throw HttpError.badRequest(
      `Não é possível registrar não comparecimento em um agendamento com status '${appointment.status}'`,
    );
  }
  assertCanMarkNoShow(appointment.start_time, now);

  let retainedCents = 0;
  if (appointment.payment_intent_id) {
    const split = await PaymentService.settleWithRetention(
      appointment.payment_intent_id,
      NO_SHOW_RETENTION_PERCENT,
    );
    if (split.status === "failed") {
      throw new HttpError(502, "Não foi possível processar o pagamento agora. Tente novamente.");
    }
    retainedCents = split.retainedCents;
  }

  appointment.status = "no_show";
  appointment.retained_cents = retainedCents;
  appointment.refunded_cents = 0;
  await appointment.save();

  await syncChatRoomStatusForAppointment(appointment.id, "no_show");
  await notifyNoShow(appointment.Client?.user_id, appointment.Service?.title, appointment.id);
  await syncBotSessionsForAppointmentStatus(appointment).catch((error: unknown) =>
    logger.warn("Falha ao sincronizar chatbot no não comparecimento", { reason: errorMessage(error) }),
  );

  logger.info("Não comparecimento registrado", { appointmentId: appointment.id, retainedCents });
  return toPublicAppointment(appointment);
}

// ---------------------------------------------------------------------------
// Reagendamento (pedido por um lado, aceito pelo outro)
// ---------------------------------------------------------------------------

async function assertNewSlotAvailable(appointment: LoadedAppointment, newStart: Date, now: Date) {
  assertMinimumAdvance(newStart, now);
  const durationMinutes = Number(appointment.Service?.duration) || 60;
  const newEnd = new Date(newStart.getTime() + durationMinutes * 60_000);
  assertValidPeriod(newStart, newEnd);
  await assertSlotInAgenda({
    professionalId: appointment.professional_id,
    start: newStart,
    durationMinutes,
    serviceId: appointment.Service?.id,
    excludeAppointmentId: appointment.id,
  });
  await assertProfessionalIsFree(
    appointment.professional_id,
    newStart,
    newEnd,
    undefined,
    appointment.id,
  );
  return newEnd;
}

export async function requestReschedule(
  userId: number,
  publicId: string,
  startTime: unknown,
  now: Date = new Date(),
) {
  const appointment = await loadAppointment(publicId);
  const actor = resolveActor(appointment, userId);
  assertCanReschedule(appointment.status, appointment.start_time, now);

  const newStart = new Date(String(startTime));
  if (Number.isNaN(newStart.getTime())) {
    throw HttpError.badRequest("Data/hora de início inválida");
  }
  if (newStart.getTime() === new Date(appointment.start_time).getTime()) {
    throw HttpError.badRequest("O novo horário é igual ao atual");
  }
  await assertNewSlotAvailable(appointment, newStart, now);

  appointment.reschedule_requested_start = newStart;
  appointment.reschedule_requested_by = actor;
  await appointment.save();

  await notifyRescheduleRequested(
    otherPartyUserId(appointment, actor),
    appointment.Service?.title,
    appointment.id,
    newStart,
  );
  return toPublicAppointment(appointment);
}

export async function respondToReschedule(
  userId: number,
  publicId: string,
  accept: unknown,
  now: Date = new Date(),
) {
  if (typeof accept !== "boolean") {
    throw HttpError.badRequest("O campo 'accept' deve ser verdadeiro ou falso");
  }
  const appointment = await loadAppointment(publicId);
  const actor = resolveActor(appointment, userId);
  const requestedStart = appointment.reschedule_requested_start;
  const requestedBy = appointment.reschedule_requested_by;

  if (!requestedStart || !requestedBy) {
    throw HttpError.badRequest("Não há pedido de reagendamento pendente");
  }
  if (requestedBy === actor) {
    throw HttpError.forbidden("Quem pediu o reagendamento não pode responder ao próprio pedido");
  }
  if (appointment.status !== "pending" && appointment.status !== "confirmed") {
    throw HttpError.badRequest(
      `Não é possível reagendar um agendamento com status '${appointment.status}'`,
    );
  }

  if (accept) {
    const newStart = new Date(requestedStart);
    const newEnd = await assertNewSlotAvailable(appointment, newStart, now);
    // Revalida sob a trava da agenda: outro pedido pode ter ocupado o horario.
    await withProfessionalScheduleLock(appointment.professional_id, async (transaction) => {
      await assertNoAppointmentOverlap(
        appointment.professional_id,
        newStart,
        newEnd,
        transaction,
        appointment.id,
      );
      appointment.start_time = newStart;
      appointment.end_time = newEnd;
      appointment.reschedule_requested_start = null;
      appointment.reschedule_requested_by = null;
      await appointment.save({ transaction });
    });
  } else {
    appointment.reschedule_requested_start = null;
    appointment.reschedule_requested_by = null;
    await appointment.save();
  }

  await notifyRescheduleAnswered(
    otherPartyUserId(appointment, actor),
    appointment.Service?.title,
    appointment.id,
    accept,
  );
  return toPublicAppointment(appointment);
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Horarios livres do profissional em um dia, para o seletor de reagendamento.
 * Apenas quem participa do agendamento (e enquanto ele ainda pode ser reagendado).
 */
export async function listRescheduleSlots(userId: number, publicId: string, date: unknown) {
  if (typeof date !== "string" || !DATE_KEY.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    throw HttpError.badRequest("Informe a data no formato AAAA-MM-DD");
  }
  const appointment = await loadAppointment(publicId);
  resolveActor(appointment, userId);
  if (appointment.status !== "pending" && appointment.status !== "confirmed") {
    throw HttpError.badRequest(
      `Não é possível reagendar um agendamento com status '${appointment.status}'`,
    );
  }
  const duration = Number(appointment.Service?.duration) || 60;
  const slots = await getAvailableSlots(
    appointment.professional_id,
    date,
    duration,
    appointment.Service?.id,
    { excludeAppointmentId: appointment.id },
  );
  return { date, slots };
}

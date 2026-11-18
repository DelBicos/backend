/**
 * Politica de cancelamento (regras puras, sem banco).
 *
 * Inspirada nas praticas de marketplaces de servico e no CDC (art. 49 e
 * boa-fe objetiva): quem cancela cedo nao paga nada, quem cancela em cima da
 * hora compensa o profissional pelo horario reservado, e o profissional que
 * cancela nunca cobra o cliente.
 *
 * Antes do aceite o valor esta apenas reservado no cartao, entao o
 * cancelamento e sempre gratuito (nada foi cobrado).
 */
import { HttpError } from "../../errors/HttpError";
import type { AppointmentStatus } from "./appointment.rules";

export const FREE_CANCELLATION_HOURS = 24;
export const LATE_CANCELLATION_HOURS = 2;
export const MID_RETENTION_PERCENT = 20;
export const LATE_RETENTION_PERCENT = 30;
export const NO_SHOW_RETENTION_PERCENT = 100;
/** Tolerancia apos o horario marcado antes de poder registrar "nao compareceu". */
export const NO_SHOW_GRACE_MINUTES = 15;
/** Prazo para o cliente abrir uma disputa apos a conclusao / nao comparecimento. */
export const DISPUTE_WINDOW_DAYS = 7;
/** Reagendamentos so podem ser pedidos com esta antecedencia minima. */
export const RESCHEDULE_MIN_HOURS = 24;

export type CancelActor = "client" | "professional" | "system";

export type CancellationTier =
  /** Pedido ainda nao aceito: so havia reserva no cartao. */
  | "unconfirmed"
  /** Mais de 24h antes: sem custo. */
  | "free"
  /** Entre 24h e 2h antes. */
  | "mid"
  /** Menos de 2h antes. */
  | "late"
  /** Cancelado pelo profissional ou pelo sistema: reembolso total. */
  | "full_refund";

export interface CancellationOutcome {
  tier: CancellationTier;
  retentionPercent: number;
  retainedCents: number;
  refundCents: number;
}

export function hoursUntil(start: Date, now: Date): number {
  return (new Date(start).getTime() - now.getTime()) / 3_600_000;
}

function outcome(
  tier: CancellationTier,
  retentionPercent: number,
  paidCents: number,
): CancellationOutcome {
  const retainedCents = Math.round((paidCents * retentionPercent) / 100);
  return {
    tier,
    retentionPercent,
    retainedCents,
    refundCents: paidCents - retainedCents,
  };
}

/** Define a faixa da politica e o percentual retido (sem depender do valor pago). */
export function retentionFor(params: {
  actor: CancelActor;
  status: AppointmentStatus;
  start: Date;
  now?: Date;
}): { tier: CancellationTier; retentionPercent: number } {
  const { actor, status, start, now = new Date() } = params;

  if (status === "pending") return { tier: "unconfirmed", retentionPercent: 0 };
  if (actor !== "client") return { tier: "full_refund", retentionPercent: 0 };

  const hours = hoursUntil(start, now);
  if (hours >= FREE_CANCELLATION_HOURS) return { tier: "free", retentionPercent: 0 };
  if (hours >= LATE_CANCELLATION_HOURS) {
    return { tier: "mid", retentionPercent: MID_RETENTION_PERCENT };
  }
  return { tier: "late", retentionPercent: LATE_RETENTION_PERCENT };
}

/** Calcula quanto e retido e quanto volta ao cliente ao cancelar. */
export function computeCancellationOutcome(params: {
  actor: CancelActor;
  status: AppointmentStatus;
  start: Date;
  paidCents: number;
  now?: Date;
}): CancellationOutcome {
  const { paidCents, ...rest } = params;
  const { tier, retentionPercent } = retentionFor(rest);
  return outcome(tier, retentionPercent, paidCents);
}

/** So se cancela antes do inicio; depois disso vale nao comparecimento ou disputa. */
export function assertCanCancel(status: AppointmentStatus, start: Date, now: Date = new Date()) {
  if (status !== "pending" && status !== "confirmed") {
    throw HttpError.badRequest(
      `Não é possível cancelar um agendamento com status '${status}'`,
    );
  }
  if (new Date(start) <= now) {
    throw HttpError.badRequest(
      "O horário do atendimento já começou. Registre o não comparecimento ou abra uma disputa.",
    );
  }
}

/** O profissional so registra "nao compareceu" apos a tolerancia. */
export function assertCanMarkNoShow(start: Date, now: Date = new Date()) {
  const limit = new Date(new Date(start).getTime() + NO_SHOW_GRACE_MINUTES * 60_000);
  if (now < limit) {
    throw HttpError.badRequest(
      `Só é possível registrar o não comparecimento ${NO_SHOW_GRACE_MINUTES} minutos após o horário marcado.`,
    );
  }
}

/** Reagendar exige antecedencia: em cima da hora vale cancelar (com a politica). */
export function assertCanReschedule(
  status: AppointmentStatus,
  currentStart: Date,
  now: Date = new Date(),
) {
  if (status !== "pending" && status !== "confirmed") {
    throw HttpError.badRequest(
      `Não é possível reagendar um agendamento com status '${status}'`,
    );
  }
  if (hoursUntil(currentStart, now) < RESCHEDULE_MIN_HOURS) {
    throw HttpError.badRequest(
      `O reagendamento precisa ser pedido com pelo menos ${RESCHEDULE_MIN_HOURS} horas de antecedência.`,
    );
  }
}

/**
 * Uma disputa so pode ser aberta sobre um atendimento concluido, um nao
 * comparecimento, ou um atendimento confirmado que o profissional nao
 * registrou (2h depois do inicio), dentro do prazo.
 */
export function assertCanDispute(params: {
  status: AppointmentStatus;
  start: Date;
  completedAt?: Date | null;
  now?: Date;
}) {
  const { status, start, completedAt, now = new Date() } = params;
  const base =
    status === "completed"
      ? (completedAt ?? start)
      : status === "no_show" || status === "confirmed"
        ? start
        : null;
  if (!base) {
    throw HttpError.badRequest(
      `Não é possível abrir disputa para um agendamento com status '${status}'`,
    );
  }
  if (status === "confirmed" && hoursUntil(start, now) > -LATE_CANCELLATION_HOURS) {
    throw HttpError.badRequest(
      "A disputa só pode ser aberta 2 horas depois do horário marcado.",
    );
  }
  const windowMs = DISPUTE_WINDOW_DAYS * 24 * 3_600_000;
  if (now.getTime() - new Date(base).getTime() > windowMs) {
    throw HttpError.badRequest(
      `O prazo de ${DISPUTE_WINDOW_DAYS} dias para abrir a disputa terminou.`,
    );
  }
}

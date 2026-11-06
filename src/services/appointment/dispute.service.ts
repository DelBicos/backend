/**
 * Disputas: o cliente contesta um atendimento (concluido, nao comparecimento
 * ou profissional ausente) dentro do prazo, e um administrador decide entre
 * reembolso total, parcial ou manter o valor.
 */
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { UserModel } from "../../models/User";
import {
  DISPUTE_REASONS,
  DISPUTE_RESOLUTIONS,
  DisputeModel,
  type DisputeReason,
  type DisputeResolution,
} from "../../models/Dispute";
import { HttpError } from "../../errors/HttpError";
import logger from "../../utils/logger";
import { PaymentService } from "../payment.service";
import { findAppointmentByPublicId } from "./appointment.service";
import { assertCanDispute } from "./cancellation.rules";
import { notifyDisputeOpened, notifyDisputeResolved } from "./appointmentNotifications.service";

import type { AppointmentWithRelations } from "./appointment.types";
export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 1000;

const APPOINTMENT_INCLUDE = [
  { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
  { model: ProfessionalModel, as: "Professional", attributes: ["id", "user_id"] },
  { model: ServiceModel, as: "Service", attributes: ["id", "title"] },
];

type Loaded = AppointmentWithRelations;

export function assertValidDispute(reason: unknown, description: unknown) {
  if (!DISPUTE_REASONS.includes(reason as DisputeReason)) {
    throw HttpError.badRequest(`Motivo inválido. Use: ${DISPUTE_REASONS.join(", ")}`);
  }
  if (typeof description !== "string") {
    throw HttpError.badRequest("Descreva o que aconteceu");
  }
  const text = description.trim();
  if (text.length < MIN_DESCRIPTION_LENGTH || text.length > MAX_DESCRIPTION_LENGTH) {
    throw HttpError.badRequest(
      `A descrição deve ter entre ${MIN_DESCRIPTION_LENGTH} e ${MAX_DESCRIPTION_LENGTH} caracteres`,
    );
  }
  return { reason: reason as DisputeReason, description: text };
}

/** Cliente abre a disputa (uma por agendamento). */
export async function openDispute(
  userId: number,
  publicId: string,
  input: { reason: unknown; description: unknown },
  now: Date = new Date(),
) {
  const { reason, description } = assertValidDispute(input.reason, input.description);
  const appointment = (await findAppointmentByPublicId(publicId, {
    include: APPOINTMENT_INCLUDE,
  })) as Loaded | null;
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");
  if (appointment.Client?.user_id !== userId) {
    throw HttpError.forbidden("Apenas o cliente do agendamento pode abrir uma disputa");
  }
  if (!appointment.payment_intent_id) {
    throw HttpError.badRequest("Este agendamento não tem pagamento online para disputar");
  }
  assertCanDispute({
    status: appointment.status,
    start: appointment.start_time,
    completedAt: appointment.completed_at,
    now,
  });

  if (await DisputeModel.findOne({ where: { appointment_id: appointment.id } })) {
    throw HttpError.conflict("Já existe uma disputa aberta para este agendamento");
  }

  const dispute = await DisputeModel.create({
    appointment_id: appointment.id,
    opened_by_user_id: userId,
    reason,
    description,
    status: "open",
  });
  await notifyDisputeOpened(appointment.Professional?.user_id, appointment.Service?.title, appointment.id);
  logger.info("Disputa aberta", { disputeId: dispute.id, appointmentId: appointment.id, reason });
  return dispute;
}

/** Cliente ou profissional do agendamento consulta a disputa. */
export async function getDisputeForAppointment(userId: number, publicId: string) {
  const appointment = (await findAppointmentByPublicId(publicId, {
    include: APPOINTMENT_INCLUDE,
  })) as Loaded | null;
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");
  if (appointment.Client?.user_id !== userId && appointment.Professional?.user_id !== userId) {
    throw HttpError.forbidden("Você não participa deste agendamento");
  }
  return DisputeModel.findOne({ where: { appointment_id: appointment.id } });
}

/** Lista para o painel do administrador (abertas primeiro). */
export async function listDisputes(status?: unknown) {
  const where = status === "open" || status === "resolved" ? { status } : {};
  const disputes = await DisputeModel.findAll({
    where,
    include: [
      {
        model: AppointmentModel,
        as: "Appointment",
        include: [
          ...APPOINTMENT_INCLUDE.slice(2),
          {
            model: ClientModel,
            as: "Client",
            include: [{ model: UserModel, as: "User", attributes: ["id", "name", "email"] }],
          },
          {
            model: ProfessionalModel,
            as: "Professional",
            include: [{ model: UserModel, as: "User", attributes: ["id", "name", "email"] }],
          },
        ],
      },
    ],
    order: [
      ["status", "ASC"],
      ["created_at", "ASC"],
    ],
  });
  return disputes;
}

export interface ResolveInput {
  resolution: unknown;
  refundCents?: unknown;
  note?: unknown;
}

/** Admin decide a disputa; o estorno sai do valor ainda retido pelo profissional. */
export async function resolveDispute(adminUserId: number, disputeId: number, input: ResolveInput) {
  if (!DISPUTE_RESOLUTIONS.includes(input.resolution as DisputeResolution)) {
    throw HttpError.badRequest(`Decisão inválida. Use: ${DISPUTE_RESOLUTIONS.join(", ")}`);
  }
  const resolution = input.resolution as DisputeResolution;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (resolution === "rejected" && !note) {
    throw HttpError.badRequest("Explique o motivo de recusar a disputa");
  }

  const dispute = await DisputeModel.findByPk(disputeId);
  if (!dispute) throw HttpError.notFound("Disputa não encontrada");
  if (dispute.status !== "open") throw HttpError.conflict("Esta disputa já foi resolvida");

  const appointment = (await AppointmentModel.findByPk(dispute.appointment_id, {
    include: APPOINTMENT_INCLUDE,
  })) as Loaded | null;
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");

  let refundCents = 0;
  if (resolution !== "rejected") {
    if (!appointment.payment_intent_id) {
      throw HttpError.badRequest("Agendamento sem pagamento online");
    }
    const paid = await PaymentService.getPaidAmountCents(appointment.payment_intent_id);
    const alreadyRefunded = appointment.refunded_cents ?? 0;
    const refundable = paid - alreadyRefunded;
    if (refundable <= 0) throw HttpError.badRequest("Não há valor a devolver neste pagamento");

    if (resolution === "refund_full") {
      refundCents = refundable;
    } else {
      const requested = Number(input.refundCents);
      if (!Number.isInteger(requested) || requested <= 0 || requested >= refundable) {
        throw HttpError.badRequest(
          `Para reembolso parcial informe refundCents entre 1 e ${refundable - 1}`,
        );
      }
      refundCents = requested;
    }

    const ok = await PaymentService.refundAmount(appointment.payment_intent_id, refundCents);
    if (!ok) {
      throw new HttpError(502, "Não foi possível processar o estorno agora. Tente novamente.");
    }
    appointment.refunded_cents = alreadyRefunded + refundCents;
    appointment.retained_cents = paid - appointment.refunded_cents;
    await appointment.save();
  }

  dispute.status = "resolved";
  dispute.resolution = resolution;
  dispute.refund_cents = refundCents;
  dispute.resolution_note = note || null;
  dispute.resolved_by_user_id = adminUserId;
  dispute.resolved_at = new Date();
  await dispute.save();

  await notifyDisputeResolved({
    userIds: [appointment.Client?.user_id, appointment.Professional?.user_id],
    serviceTitle: appointment.Service?.title,
    appointmentId: appointment.id,
    resolution,
    refundCents,
  });
  logger.info("Disputa resolvida", { disputeId, resolution, refundCents });
  return dispute;
}

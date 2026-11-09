/**
 * Atendimento em domicilio, passo a passo: o profissional sai a caminho,
 * confirma a chegada pelo GPS, inicia com o codigo do cliente e conclui.
 * Traduz o resultado das regras de check-in em respostas HTTP.
 */
import { AddressModel } from "../../models/Address";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { UserModel } from "../../models/User";
import { HttpError } from "../../errors/HttpError";
import { findAppointmentByPublicId, toPublicAppointment } from "./appointment.service";
import {
  canUserAccessAuditTrail,
  ensureVerificationCode,
  fetchAppointmentAuditTrail,
  processAppointmentArrived,
  processAppointmentCheckin,
  processAppointmentCheckout,
  processAppointmentInTransit,
  type AppointmentWithRelations,
} from "./checkin.service";

const USER_ATTRIBUTES = ["id", "name", "avatar_uri", "phone", "email"];

async function loadVisit(publicId: string): Promise<AppointmentWithRelations> {
  const appointment = await findAppointmentByPublicId(publicId, {
    include: [
      { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User", attributes: USER_ATTRIBUTES }] },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: USER_ATTRIBUTES }],
      },
      { model: ServiceModel, as: "Service" },
      { model: AddressModel, as: "Address" },
    ],
  });
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");
  return appointment as AppointmentWithRelations;
}

function fail(status: number, error: string, details?: unknown): never {
  if (status === 403) throw HttpError.forbidden(error);
  if (status === 409) throw HttpError.conflict(error);
  throw HttpError.badRequest(error, details);
}

function parseCoordinate(value: unknown, field: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw HttpError.badRequest(`O campo '${field}' é obrigatório e deve ser numérico`);
  }
  return n;
}

function parseCode(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Detalhes do agendamento para o cliente ou o profissional dele. */
export async function getVisitDetails(userId: number, publicId: string) {
  const appointment = await loadVisit(publicId);
  if (appointment.Client?.user_id !== userId && appointment.Professional?.user_id !== userId) {
    throw HttpError.forbidden("Acesso negado a este agendamento");
  }
  return toPublicAppointment(appointment, userId);
}

export async function markInTransit(userId: number, publicId: string) {
  const appointment = await loadVisit(publicId);
  await ensureVerificationCode(appointment);
  const result = await processAppointmentInTransit(appointment, userId);
  if (!result.success) fail(result.status, result.error);
  return {
    message: "Status atualizado para em deslocamento.",
    appointment: toPublicAppointment(result.appointment, userId),
  };
}

export async function markArrived(userId: number, publicId: string, body: { latitude?: unknown; longitude?: unknown }) {
  const latitude = parseCoordinate(body.latitude, "latitude");
  const longitude = parseCoordinate(body.longitude, "longitude");
  const appointment = await loadVisit(publicId);
  await ensureVerificationCode(appointment);
  const result = await processAppointmentArrived(appointment, userId, latitude, longitude);
  if (!result.success) {
    fail(result.status, result.error, { distance: result.distance, maxDistance: result.maxDistance });
  }
  // O codigo vai so para o cliente (por notificacao e socket), nunca nesta resposta ao profissional.
  return { message: "Chegada confirmada. Peça o código ao cliente." };
}

export async function startService(userId: number, publicId: string, code: unknown) {
  const appointment = await loadVisit(publicId);
  const result = await processAppointmentCheckin(appointment, userId, parseCode(code));
  if (!result.success) fail(result.status, result.error);
  return { message: "Atendimento iniciado.", started_at: result.startedAt };
}

export async function completeService(userId: number, publicId: string, code: unknown) {
  const appointment = await loadVisit(publicId);
  const result = await processAppointmentCheckout(appointment, userId, parseCode(code));
  if (!result.success) fail(result.status, result.error);
  return { message: "Atendimento concluído.", completed_at: result.completedAt };
}

export async function getAuditTrail(userId: number, publicId: string, isAdmin: boolean) {
  const appointment = await loadVisit(publicId);
  if (!(await canUserAccessAuditTrail(appointment, userId, isAdmin))) {
    throw HttpError.forbidden("Acesso negado à trilha de auditoria");
  }
  return { appointment_id: appointment.short_id, logs: await fetchAppointmentAuditTrail(appointment.id) };
}

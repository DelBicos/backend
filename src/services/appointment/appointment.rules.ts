/**
 * Regras de negocio puras do agendamento (sem acesso a banco),
 * faceis de testar isoladamente.
 */
import { HttpError } from "../../errors/HttpError";
import { distanceKm, toCoordinate } from "../../utils/geo.util";

export const MIN_ADVANCE_DAYS = 2;
export const MAX_REVIEW_LENGTH = 500;

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "canceled";

/** Agendamentos exigem no minimo 2 dias (a partir de hoje, 00:00) de antecedencia. */
export function assertMinimumAdvance(start: Date, now: Date = new Date()): void {
  if (Number.isNaN(start.getTime())) {
    throw HttpError.badRequest("Data/hora de início inválida");
  }
  const minDate = new Date(now);
  minDate.setHours(0, 0, 0, 0);
  minDate.setDate(minDate.getDate() + MIN_ADVANCE_DAYS);
  if (start < minDate) {
    throw HttpError.badRequest(
      "Os agendamentos precisam ser feitos com no mínimo 48 horas (2 dias) de antecedência.",
    );
  }
}

export function assertValidPeriod(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw HttpError.badRequest("Datas do agendamento inválidas");
  }
  if (end <= start) {
    throw HttpError.badRequest("O horário de término deve ser após o início");
  }
}

/** O cliente precisa estar dentro do raio de atuacao do profissional (RF04). */
export function assertWithinServiceRadius(params: {
  professionalLat: unknown;
  professionalLng: unknown;
  clientLat: unknown;
  clientLng: unknown;
  radiusKm: unknown;
}): void {
  const pLat = toCoordinate(params.professionalLat);
  const pLng = toCoordinate(params.professionalLng);
  const cLat = toCoordinate(params.clientLat);
  const cLng = toCoordinate(params.clientLng);
  const radius = toCoordinate(params.radiusKm);
  // Sem dados suficientes, a regra nao se aplica.
  if (pLat === null || pLng === null || cLat === null || cLng === null || !radius) {
    return;
  }
  if (distanceKm(pLat, pLng, cLat, cLng) > radius) {
    throw HttpError.badRequest(
      "O endereço do cliente está fora do raio de atuação do profissional",
    );
  }
}

export function assertValidReview(rating: unknown, review: unknown): {
  rating: number;
  review: string | null;
} {
  const value = Number(rating);
  if (rating === undefined || rating === null || rating === "") {
    throw HttpError.badRequest("O campo 'rating' é obrigatório");
  }
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw HttpError.badRequest("A avaliação deve estar entre 1 e 5");
  }
  if (review !== undefined && review !== null && typeof review !== "string") {
    throw HttpError.badRequest("O comentário deve ser um texto");
  }
  const text = typeof review === "string" ? review.trim() : "";
  if (text.length > MAX_REVIEW_LENGTH) {
    throw HttpError.badRequest(
      `O comentário deve ter no máximo ${MAX_REVIEW_LENGTH} caracteres`,
    );
  }
  return { rating: value, review: text || null };
}

/** Transicoes que o profissional pode fazer ao responder um pedido. */
export const PROFESSIONAL_RESPONSES = ["confirmed", "canceled"] as const;
export type ProfessionalResponse = (typeof PROFESSIONAL_RESPONSES)[number];

export function assertProfessionalResponse(status: unknown): ProfessionalResponse {
  if (!PROFESSIONAL_RESPONSES.includes(status as ProfessionalResponse)) {
    throw HttpError.badRequest("Status inválido. Use 'confirmed' ou 'canceled'.");
  }
  return status as ProfessionalResponse;
}

export function assertStatus(
  current: AppointmentStatus,
  expected: AppointmentStatus,
  action: string,
): void {
  if (current !== expected) {
    throw HttpError.badRequest(
      `Não é possível ${action} um agendamento com status '${current}'`,
    );
  }
}

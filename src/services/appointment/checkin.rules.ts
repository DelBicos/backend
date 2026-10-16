import { confirmationCodesMatch } from "../../utils/confirmationCode.util";

export const MAX_ARRIVAL_DISTANCE_METERS = 300;

export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface DistanceValidationResult {
  valid: boolean;
  distance?: number;
  maxDistance: number;
  error?: string;
}

export function validateArrivedDistance(
  profLat: number,
  profLng: number,
  addrLat?: number | null,
  addrLng?: number | null,
  maxDistance: number = MAX_ARRIVAL_DISTANCE_METERS,
): DistanceValidationResult {
  if (addrLat == null || addrLng == null) {
    return { valid: true, maxDistance };
  }

  const distanceMeters = calculateDistanceInMeters(
    Number(profLat),
    Number(profLng),
    Number(addrLat),
    Number(addrLng),
  );

  if (distanceMeters > maxDistance) {
    const roundedDistance = Math.round(distanceMeters);
    return {
      valid: false,
      distance: roundedDistance,
      maxDistance,
      error: `Você está a ${roundedDistance}m do endereço do cliente. Aproxime-se (menos de ${maxDistance}m) para confirmar a chegada.`,
    };
  }

  return { valid: true, distance: Math.round(distanceMeters), maxDistance };
}

export function validateConfirmationCode(
  providedCode: string | undefined,
  expectedCode: string | null | undefined,
): boolean {
  return confirmationCodesMatch(providedCode, expectedCode);
}

export type TransitionRuleResult =
  | { valid: true }
  | {
      valid: false;
      status: 400 | 403;
      error: string;
      reason?: "already_used" | "already_completed" | "invalid_code" | "invalid_status";
    };

export function validateInTransitTransition(
  currentStatus: string,
  professionalUserId?: number,
  requestingUserId?: number,
): TransitionRuleResult {
  if (!professionalUserId || !requestingUserId || professionalUserId !== requestingUserId) {
    return {
      valid: false,
      status: 403,
      error: "Apenas o profissional responsável pode informar que está a caminho.",
    };
  }

  if (currentStatus !== "confirmed" && currentStatus !== "in_transit") {
    return {
      valid: false,
      status: 400,
      error: `Não é possível marcar a caminho um agendamento com status '${currentStatus}'`,
      reason: "invalid_status",
    };
  }

  return { valid: true };
}

export function validateArrivedTransition(
  currentStatus: string,
  professionalUserId?: number,
  requestingUserId?: number,
): TransitionRuleResult {
  if (!professionalUserId || !requestingUserId || professionalUserId !== requestingUserId) {
    return {
      valid: false,
      status: 403,
      error: "Apenas o profissional responsável pode marcar chegada.",
    };
  }

  if (currentStatus !== "in_transit" && currentStatus !== "arrived") {
    return {
      valid: false,
      status: 400,
      error: `Não é possível marcar chegada em um agendamento com status '${currentStatus}'`,
      reason: "invalid_status",
    };
  }

  return { valid: true };
}

export function validateCheckinTransition(
  currentStatus: string,
  professionalUserId?: number,
  requestingUserId?: number,
  code?: string,
  expectedCode?: string | null,
): TransitionRuleResult {
  if (!professionalUserId || !requestingUserId || professionalUserId !== requestingUserId) {
    return {
      valid: false,
      status: 403,
      error: "Apenas o profissional responsável pode iniciar o serviço.",
    };
  }

  if (currentStatus === "in_progress" || currentStatus === "completed") {
    return {
      valid: false,
      status: 400,
      error: "Este código já foi utilizado para este agendamento.",
      reason: "already_used",
    };
  }

  if (currentStatus !== "arrived") {
    return {
      valid: false,
      status: 400,
      error: `Não é possível iniciar o serviço em um agendamento com status '${currentStatus}'. Confirme a chegada primeiro.`,
      reason: "invalid_status",
    };
  }

  if (!validateConfirmationCode(code, expectedCode)) {
    return {
      valid: false,
      status: 400,
      error: "Código de confirmação incorreto. Verifique o código com o cliente.",
      reason: "invalid_code",
    };
  }

  return { valid: true };
}

export function validateCheckoutTransition(
  currentStatus: string,
  professionalUserId?: number,
  requestingUserId?: number,
  code?: string,
  expectedCode?: string | null,
): TransitionRuleResult {
  if (!professionalUserId || !requestingUserId || professionalUserId !== requestingUserId) {
    return {
      valid: false,
      status: 403,
      error: "Apenas o profissional responsável pode finalizar o serviço.",
    };
  }

  if (currentStatus === "completed") {
    return {
      valid: false,
      status: 400,
      error: "Este serviço já foi concluído anteriormente.",
      reason: "already_completed",
    };
  }

  if (currentStatus !== "in_progress") {
    return {
      valid: false,
      status: 400,
      error: `Não é possível finalizar um serviço com status '${currentStatus}'. O serviço precisa estar em andamento.`,
      reason: "invalid_status",
    };
  }

  if (!validateConfirmationCode(code, expectedCode)) {
    return {
      valid: false,
      status: 400,
      error: "Código de confirmação incorreto. Verifique o código com o cliente.",
      reason: "invalid_code",
    };
  }

  return { valid: true };
}

export function canAccessAuditTrailRule(
  clientUserId?: number,
  professionalUserId?: number,
  requestingUserId?: number,
  isAdmin?: boolean,
): boolean {
  if (isAdmin) return true;
  if (!requestingUserId) return false;
  return requestingUserId === clientUserId || requestingUserId === professionalUserId;
}

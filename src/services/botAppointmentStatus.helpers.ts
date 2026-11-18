import type { AppointmentStatusValue } from "../models/Appointment";

export type AppointmentStatus = AppointmentStatusValue;

/** Etapas do atendimento em domicilio, depois da confirmacao. */
const SERVICE_STEPS: readonly AppointmentStatus[] = ["in_transit", "arrived", "in_progress"];

interface AppointmentPaymentSnapshot {
  status: AppointmentStatus;
  payment_intent_id?: string | null;
}

export function getAppointmentPaymentStatus(
  appointment: AppointmentPaymentSnapshot,
): "not_available" | "pending" | "paid" {
  if (appointment.payment_intent_id) return "paid";
  return appointment.status === "confirmed" || SERVICE_STEPS.includes(appointment.status)
    ? "pending"
    : "not_available";
}

export function getAppointmentStatusMessage(
  status: AppointmentStatus,
  paid: boolean,
): string {
  // O codigo de inicio nao entra aqui: esta mensagem vai tambem ao profissional.
  if (status === "in_transit") return "O profissional está a caminho do local do serviço.";
  if (status === "arrived") {
    return "O profissional chegou ao local. Informe a ele o código de início do atendimento.";
  }
  if (status === "in_progress") return "O serviço está em andamento.";
  if (status === "confirmed" && paid) {
    return "\u2705 Pagamento confirmado. Seu agendamento est\u00e1 confirmado e pago.";
  }
  if (status === "confirmed") {
    return "\u2705 O profissional confirmou seu agendamento. O pagamento est\u00e1 pendente; use a op\u00e7\u00e3o Pagar para finalizar.";
  }
  if (status === "canceled") {
    return "\u274c O profissional recusou ou o agendamento foi cancelado.";
  }
  if (status === "no_show") {
    return "\u274c O agendamento foi encerrado por n\u00e3o comparecimento.";
  }
  if (status === "completed") return "\u2705 O agendamento foi conclu\u00eddo.";
  return "O agendamento continua pendente de resposta do profissional.";
}

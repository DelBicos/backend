export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "canceled";

interface AppointmentPaymentSnapshot {
  status: AppointmentStatus;
  payment_intent_id?: string | null;
}

export function getAppointmentPaymentStatus(
  appointment: AppointmentPaymentSnapshot,
): "not_available" | "pending" | "paid" {
  if (appointment.payment_intent_id) return "paid";
  return appointment.status === "confirmed" ? "pending" : "not_available";
}

export function getAppointmentStatusMessage(
  status: AppointmentStatus,
  paid: boolean,
): string {
  if (status === "confirmed" && paid) {
    return "\u2705 Pagamento confirmado. Seu agendamento est\u00e1 confirmado e pago.";
  }
  if (status === "confirmed") {
    return "\u2705 O profissional confirmou seu agendamento. O pagamento est\u00e1 pendente; use a op\u00e7\u00e3o Pagar para finalizar.";
  }
  if (status === "canceled") {
    return "\u274c O profissional recusou ou o agendamento foi cancelado.";
  }
  if (status === "completed") return "\u2705 O agendamento foi conclu\u00eddo.";
  return "O agendamento continua pendente de resposta do profissional.";
}

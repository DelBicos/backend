export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "in_transit"
  | "arrived"
  | "in_progress"
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
  return appointment.status === "confirmed" || appointment.status === "in_transit" || appointment.status === "arrived" || appointment.status === "in_progress" ? "pending" : "not_available";
}

export function getAppointmentStatusMessage(
  status: AppointmentStatus,
  paid: boolean,
  code?: string | null,
): string {
  if (status === "in_transit") {
    return "🚗 O profissional está a caminho do local do serviço.";
  }
  if (status === "arrived") {
    return `🎯 O profissional chegou ao local do atendimento! Seu código de confirmação é: ${code || ""}. Informe este código ao profissional para iniciar o serviço.`;
  }
  if (status === "in_progress") {
    return "⚡ O serviço está em andamento.";
  }
  if (status === "confirmed" && paid) {
    return "✅ Pagamento confirmado. Seu agendamento está confirmado e pago.";
  }
  if (status === "confirmed") {
    return "✅ O profissional confirmou seu agendamento. O pagamento está pendente; use a opção Pagar para finalizar.";
  }
  if (status === "canceled") {
    return "❌ O profissional recusou ou o agendamento foi cancelado.";
  }
  if (status === "completed") return "✅ O agendamento foi concluído.";
  return "O agendamento continua pendente de resposta do profissional.";
}

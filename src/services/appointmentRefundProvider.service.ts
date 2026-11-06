import { getStripe } from "../config/stripe";

/**
 * Devolve ao cliente um pagamento que nao sera usado, de forma idempotente.
 * - reservado (requires_capture) ou incompleto: cancela a reserva;
 * - ja cobrado (succeeded): estorna o saldo, reconciliando antes de reenviar
 *   (inclusive apos expirar a chave idempotente do Stripe).
 * Retorna true quando a devolucao esta concluida; false quando ainda esta em
 * andamento no provedor (a fila tenta de novo mais tarde).
 */
export async function ensureAppointmentRefund(paymentIntentId: string): Promise<boolean> {
  const api = getStripe();
  const payment = await api.paymentIntents.retrieve(paymentIntentId);
  if (payment.status === "canceled") return true;
  if (payment.status !== "succeeded") {
    await api.paymentIntents.cancel(paymentIntentId);
    return true;
  }
  if (payment.amount_received <= 0) return true;

  let refunded = 0;
  let pending = false;
  let latestRefundId: string | undefined;
  for await (const refund of api.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
    latestRefundId ??= refund.id;
    if (refund.status === "succeeded") refunded += refund.amount;
    if (refund.status === "pending" || refund.status === "requires_action") pending = true;
  }
  if (refunded >= payment.amount_received) return true;
  if (pending) return false;

  // A mesma tentativa conserva a chave apos timeout/crash. Uma falha terminal
  // ja identificada no provedor permite uma nova tentativa com outra chave.
  const refund = await api.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `appointment-refund:${paymentIntentId}:${latestRefundId ?? "initial"}` },
  );
  if (refund.status === "failed" || refund.status === "canceled")
    throw new Error(`Estorno ${refund.id}: ${refund.status}`);
  return refund.status === "succeeded" && refunded + refund.amount >= payment.amount_received;
}

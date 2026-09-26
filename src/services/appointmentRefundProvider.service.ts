import Stripe from "stripe";

let client: Stripe | undefined;
function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key?.startsWith("sk_")) throw new Error("STRIPE_SECRET_KEY não configurada");
    client = new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  }
  return client;
}

/** Reconcilia antes de reenviar, inclusive após expirar a chave idempotente do Stripe.
 * Um estorno pendente no provedor ainda não é um estorno concluído.
 */
export async function ensureAppointmentRefund(paymentIntentId: string): Promise<boolean> {
  const api = stripe();
  const payment = await api.paymentIntents.retrieve(paymentIntentId);
  if (payment.status !== "succeeded" || payment.amount_received <= 0)
    throw new Error("Pagamento não liquidado para estorno");

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

  // A mesma tentativa conserva a chave após timeout/crash. Uma falha terminal
  // já identificada no provedor permite uma nova tentativa com outra chave.
  const refund = await api.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `appointment-refund:${paymentIntentId}:${latestRefundId ?? "initial"}` },
  );
  if (refund.status === "failed" || refund.status === "canceled")
    throw new Error(`Estorno ${refund.id}: ${refund.status}`);
  return refund.status === "succeeded" && refunded + refund.amount >= payment.amount_received;
}

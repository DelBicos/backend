import Stripe from "stripe";
import { MissingEnvError } from "./env";

let client: Stripe | null = null;

/**
 * Cliente Stripe criado sob demanda. Evita derrubar o processo inteiro
 * (ou os testes) no import quando STRIPE_SECRET_KEY nao esta configurada;
 * o erro surge apenas quando um pagamento e de fato solicitado.
 */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_")) {
    throw new MissingEnvError("STRIPE_SECRET_KEY");
  }
  client = new Stripe(key, { typescript: true });
  return client;
}

/** Apenas para testes: descarta o cliente em cache. */
export function resetStripeClient(): void {
  client = null;
}

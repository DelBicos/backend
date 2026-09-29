/**
 * Acerto do dinheiro de um pagamento no Stripe: cobrar a reserva, liberar,
 * estornar ou reter uma parte (politica de cancelamento).
 */
import { getStripe } from "../../config/stripe";
import { HttpError } from "../../errors/HttpError";
import { errorMessage } from "../../utils/errors.util";
import logger from "../../utils/logger";

/** Situacao final de um pagamento que nao sera aproveitado. */
export type PaymentSettlement = "released" | "refunded" | "failed";

/** Resultado de acertar um pagamento com retencao parcial. */
export interface PaymentSplit {
  status: "ok" | "failed";
  paidCents: number;
  retainedCents: number;
  refundedCents: number;
}

export const PaymentSettlementOperations = {
  /**
   * Cobra o valor reservado (chamado quando o profissional aceita).
   * Idempotente: se ja foi capturado, nao faz nada.
   */
  capturePayment: async (paymentIntentId: string): Promise<void> => {
    try {
      const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
      if (intent.status === "succeeded") return;
      if (intent.status !== "requires_capture") {
        throw HttpError.conflict(
          "A reserva do pagamento não está mais disponível. Peça ao cliente para refazer o agendamento.",
        );
      }
      await getStripe().paymentIntents.capture(paymentIntentId);
      logger.info("[PaymentService] Pagamento capturado", { paymentIntentId });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      logger.error("[PaymentService] Falha ao capturar pagamento", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      throw HttpError.conflict(
        "Não foi possível cobrar o pagamento (a reserva pode ter expirado).",
      );
    }
  },

  /**
   * Devolve o dinheiro de um pagamento que nao sera usado: libera a reserva
   * se ainda nao foi cobrado, ou estorna se ja foi capturado.
   */
  settleUnusedPayment: async (paymentIntentId: string): Promise<PaymentSettlement> => {
    try {
      const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
      if (intent.status === "canceled") return "released";
      if (intent.status === "succeeded") {
        await getStripe().refunds.create({ payment_intent: paymentIntentId });
        logger.info("[PaymentService] Pagamento estornado", { paymentIntentId });
        return "refunded";
      }
      await getStripe().paymentIntents.cancel(paymentIntentId);
      logger.info("[PaymentService] Reserva do pagamento liberada", { paymentIntentId });
      return "released";
    } catch (error) {
      logger.error("[PaymentService] Erro ao devolver pagamento", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      return "failed";
    }
  },

  /** Valor total do pagamento em centavos (0 se nao for possivel consultar). */
  getPaidAmountCents: async (paymentIntentId: string): Promise<number> => {
    try {
      const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
      return intent.amount ?? 0;
    } catch (error) {
      logger.error("[PaymentService] Falha ao consultar valor do pagamento", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      return 0;
    }
  },

  /**
   * Acerta um pagamento retendo `retentionPercent`% para o profissional e
   * devolvendo o restante ao cliente.
   * - reservado (requires_capture): captura so o valor retido; o resto e
   *   liberado pelo Stripe (ou libera tudo se nada e retido);
   * - ja cobrado (succeeded): estorna a diferenca.
   */
  settleWithRetention: async (
    paymentIntentId: string,
    retentionPercent: number,
  ): Promise<PaymentSplit> => {
    try {
      const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
      const paid = intent.amount ?? 0;
      const percent = Math.min(Math.max(retentionPercent, 0), 100);
      const retained = Math.round((paid * percent) / 100);
      const refund = paid - retained;

      if (intent.status === "requires_capture") {
        if (retained === 0) {
          await getStripe().paymentIntents.cancel(paymentIntentId);
        } else {
          await getStripe().paymentIntents.capture(paymentIntentId, {
            amount_to_capture: retained,
          });
        }
      } else if (intent.status === "succeeded") {
        if (refund > 0) {
          await getStripe().refunds.create({
            payment_intent: paymentIntentId,
            amount: refund,
          });
        }
      } else if (intent.status !== "canceled") {
        throw new Error(`Status inesperado do pagamento: ${intent.status}`);
      }

      logger.info("[PaymentService] Pagamento acertado", {
        paymentIntentId,
        retained,
        refund,
      });
      return { status: "ok", paidCents: paid, retainedCents: retained, refundedCents: refund };
    } catch (error) {
      logger.error("[PaymentService] Erro ao acertar pagamento", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      return { status: "failed", paidCents: 0, retainedCents: 0, refundedCents: 0 };
    }
  },

  /** Estorno parcial de um pagamento ja cobrado (resolucao de disputa). */
  refundAmount: async (paymentIntentId: string, amountCents: number): Promise<boolean> => {
    try {
      await getStripe().refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amountCents),
      });
      return true;
    } catch (error) {
      logger.error("[PaymentService] Erro ao estornar valor", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      return false;
    }
  },

  /** @deprecated use settleUnusedPayment; mantido para chamadas antigas. */
  refundPaymentIntent: async (paymentIntentId: string): Promise<boolean> => {
    try {
      await getStripe().refunds.create({ payment_intent: paymentIntentId });
      logger.info("[PaymentService] Reembolso acionado no Stripe", { paymentIntentId });
      return true;
    } catch (error) {
      logger.error("[PaymentService] Erro ao processar reembolso no Stripe", {
        paymentIntentId,
        reason: errorMessage(error),
      });
      return false;
    }
  },
};

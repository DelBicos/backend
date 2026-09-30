import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { AppointmentModel } from "../models/Appointment";
import { AppointmentRefundModel } from "../models/AppointmentRefund";
import { ensureAppointmentRefund } from "./appointmentRefundProvider.service";
import { errorMessage } from "../utils/errors.util";
import logger from "../utils/logger";

/**
 * Fila de devolucao de pagamentos (outbox): sobrevive a falhas do Stripe e a
 * reinicios. Cada item libera a reserva ou estorna o pagamento, com retentativa.
 */

const RETRY_DELAY_MS = 10 * 60 * 1000;

/** Deve ser chamado dentro da transação que cancela a reserva, sob a trava da agenda. */
export async function enqueueAppointmentRefund(appointment: AppointmentModel, transaction: Transaction) {
  if (!appointment.payment_intent_id) return;
  await enqueuePaymentRefund(appointment.payment_intent_id, appointment.id, transaction);
}

/** Também registra pagamentos que não puderam gerar ou ser vinculados a uma reserva. */
export async function enqueuePaymentRefund(
  paymentIntentId: string,
  appointmentId: number | null,
  transaction?: Transaction,
): Promise<void> {
  await AppointmentRefundModel.findOrCreate({
    where: { payment_intent_id: paymentIntentId },
    defaults: { appointment_id: appointmentId, payment_intent_id: paymentIntentId },
    transaction,
  });
}

/** Processa um item da fila. Retorna true se a devolução foi concluída. */
async function processRefundJob(jobId: number, force: boolean): Promise<boolean> {
  let completed = false;
  // Serializa workers pelo item da fila; não mantém a agenda bloqueada durante a API.
  await sequelize.transaction(async (transaction) => {
    const job = await AppointmentRefundModel.findByPk(jobId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!job || job.status !== "pending") {
      completed = job?.status === "completed";
      return;
    }
    if (!force && job.next_attempt_at > new Date()) return;
    job.attempts += 1;
    try {
      completed = await ensureAppointmentRefund(job.payment_intent_id);
      job.status = completed ? "completed" : "pending";
      job.last_error = null;
    } catch (error) {
      job.last_error = errorMessage(error);
      logger.error("Falha na devolução de pagamento; será retentada", {
        refundId: job.id,
        error: job.last_error,
      });
    }
    job.next_attempt_at = new Date(Date.now() + RETRY_DELAY_MS);
    await job.save({ transaction });
  });
  return completed;
}

/**
 * Tenta devolver agora um pagamento ja enfileirado (chamar depois do commit).
 * Se falhar, o item continua na fila e o cron tenta de novo.
 */
export async function settleQueuedPayment(paymentIntentId: string): Promise<boolean> {
  try {
    const job = await AppointmentRefundModel.findOne({
      where: { payment_intent_id: paymentIntentId },
    });
    return job ? await processRefundJob(job.id, true) : false;
  } catch (error) {
    logger.error("Falha ao processar devolução imediata", {
      paymentIntentId,
      error: errorMessage(error),
    });
    return false;
  }
}

/** Executado pelo cron: processa os itens vencidos da fila. */
export async function processAppointmentRefunds(): Promise<void> {
  const due = await AppointmentRefundModel.findAll({
    where: { status: "pending", next_attempt_at: { [Op.lte]: new Date() } },
    order: [["next_attempt_at", "ASC"], ["id", "ASC"]],
    limit: 100,
  });
  for (const candidate of due) {
    try {
      await processRefundJob(candidate.id, false);
    } catch (error) {
      // Falha de commit conserva o item pendente. A próxima execução reconcilia o Stripe.
      logger.error("Falha ao processar item de devolução", {
        refundId: candidate.id,
        error: errorMessage(error),
      });
    }
  }
}

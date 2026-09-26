import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { AppointmentModel } from "../models/Appointment";
import { AppointmentRefundModel } from "../models/AppointmentRefund";
import { ensureAppointmentRefund } from "./appointmentRefundProvider.service";
import logger from "../utils/logger";

/** Deve ser chamado dentro da transação que cancela a reserva, sob a trava da agenda. */
export async function enqueueAppointmentRefund(appointment: AppointmentModel, transaction: Transaction) {
  if (!appointment.payment_intent_id) return;
  await AppointmentRefundModel.findOrCreate({
    where: { payment_intent_id: appointment.payment_intent_id },
    defaults: { appointment_id: appointment.id, payment_intent_id: appointment.payment_intent_id },
    transaction,
  });
}

export async function processAppointmentRefunds(): Promise<void> {
  const due = await AppointmentRefundModel.findAll({
    where: { status: "pending", next_attempt_at: { [Op.lte]: new Date() } },
    order: [["next_attempt_at", "ASC"], ["id", "ASC"]], limit: 100,
  });
  for (const candidate of due) {
    try {
      // Serializa workers pelo item da fila; não mantém a agenda bloqueada durante a API.
      await sequelize.transaction(async (transaction) => {
        const job = await AppointmentRefundModel.findByPk(candidate.id, {
          transaction, lock: transaction.LOCK.UPDATE,
        });
        if (!job || job.status !== "pending" || job.next_attempt_at > new Date()) return;
        job.attempts += 1;
        try {
          const completed = await ensureAppointmentRefund(job.payment_intent_id);
          job.status = completed ? "completed" : "pending";
          job.last_error = null;
        } catch (error) {
          job.last_error = error instanceof Error ? error.message : String(error);
          logger.error("Falha no estorno de agendamento; será retentado", { refundId: job.id, error: job.last_error });
        }
        job.next_attempt_at = new Date(Date.now() + 10 * 60 * 1000);
        await job.save({ transaction });
      });
    } catch (error) {
      // Falha de commit conserva o item pendente. A próxima execução reconcilia o Stripe.
      logger.error("Falha ao processar item de estorno", { refundId: candidate.id, error });
    }
  }
}

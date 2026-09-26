import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { ProfessionalModel } from "../models/Professional";
import { AppointmentModel, IAppointment } from "../models/Appointment";
import { ProfessionalAvailabilityLockModel } from "../models/ProfessionalAvailabilityLock";
import { ServiceModel } from "../models/Service";
import { appointmentOverlapWhere } from "./availability.service";
import { enqueueAppointmentRefund } from "./appointmentRefund.service";

export class ScheduleConflictError extends Error {
  readonly status = 409;
}

/** Todos os escritores da agenda devem adquirir o profissional antes da reserva.
 * READ COMMITTED faz a consulta após o lock enxergar o commit do escritor anterior.
 * Bloquear apenas reservas existentes não protege um intervalo ainda vazio.
 */
export async function withProfessionalScheduleLock<T>(
  professionalId: number,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
    async (transaction) => {
      const professional = await ProfessionalModel.findByPk(professionalId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!professional) throw new Error("Profissional não encontrado");
      return work(transaction);
    },
  );
}

export async function assertNoAppointmentOverlap(
  professionalId: number,
  start: Date,
  end: Date,
  transaction: Transaction,
  excludeAppointmentId?: number,
): Promise<void> {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    throw new ScheduleConflictError("Intervalo de agendamento inválido");
  }
  const existing = await AppointmentModel.findOne({
    where: appointmentOverlapWhere(
      professionalId,
      start,
      end,
      excludeAppointmentId,
    ),
    transaction,
  });
  const block = await ProfessionalAvailabilityLockModel.findOne({
    where: {
      professional_id: professionalId,
      start_time: { [Op.lt]: end },
      end_time: { [Op.gt]: start },
    },
    transaction,
  });
  if (existing || block)
    throw new ScheduleConflictError(
      "Horário não está mais disponível. Por favor, escolha outro horário.",
    );
}

export async function createAppointmentWithScheduleLock(
  data: IAppointment,
): Promise<AppointmentModel> {
  return withProfessionalScheduleLock(
    data.professional_id,
    async (transaction) => {
      // Duas confirmações do mesmo pagamento não devem gerar conflito e estorno.
      if (data.payment_intent_id) {
        const paid = await AppointmentModel.findOne({
          where: { payment_intent_id: data.payment_intent_id },
          transaction,
        });
        if (
          paid &&
          paid.client_id === data.client_id &&
          paid.service_id === data.service_id &&
          paid.professional_id === data.professional_id
        )
          return paid;
        if (paid)
          throw new ScheduleConflictError(
            "Pagamento já vinculado a outro agendamento",
          );
      }
      const service = await ServiceModel.findByPk(data.service_id, {
        transaction,
      });
      if (
        !service?.active ||
        service.professional_id !== data.professional_id
      ) {
        throw new ScheduleConflictError(
          "Serviço inativo ou não pertence ao profissional",
        );
      }
      await assertNoAppointmentOverlap(
        data.professional_id,
        data.start_time,
        data.end_time,
        transaction,
      );
      return AppointmentModel.create(data, { transaction });
    },
  );
}

export async function changePendingAppointmentStatus(
  appointment: AppointmentModel,
  status: "confirmed" | "canceled",
): Promise<void> {
  await withProfessionalScheduleLock(
    appointment.professional_id,
    async (transaction) => {
      const current = await AppointmentModel.findByPk(appointment.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (
        !current ||
        current.status !== "pending" ||
        new Date(current.start_time).getTime() !==
          new Date(appointment.start_time).getTime()
      ) {
        throw new ScheduleConflictError(
          "O agendamento foi alterado. Atualize a agenda antes de confirmar.",
        );
      }
      current.status = status;
      await current.save({ transaction });
      if (status === "canceled") await enqueueAppointmentRefund(current, transaction);
    },
  );
  appointment.status = status;
}

/** Uma remarcação reinicia o prazo de aceite sem alterar a data de criação. */
export async function expirePendingAppointment(
  appointment: AppointmentModel,
  deadline: Date,
): Promise<boolean> {
  const expired = await withProfessionalScheduleLock(
    appointment.professional_id,
    async (transaction) => {
      const current = await AppointmentModel.findByPk(appointment.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (
        !current ||
        current.status !== "pending" ||
        new Date(current.updatedAt) > deadline
      )
        return false;
      current.status = "canceled";
      await current.save({ transaction });
      await enqueueAppointmentRefund(current, transaction);
      return true;
    },
  );
  if (expired) appointment.status = "canceled";
  return expired;
}

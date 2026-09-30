import { ClientModel } from "../../../models/Client";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { AddressModel } from "../../../models/Address";
import { AppointmentModel } from "../../../models/Appointment";
import { UserModel } from "../../../models/User";
import { NotificationModel } from "../../../models/Notification";
import { BotSessionContext } from "../../../models/BotChatSession";
import {
  DEFAULT_BOT_TIME_ZONE,
  isValidBookingDate,
  parseLocalAppointmentStart,
} from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { withProfessionalScheduleLock } from "../../appointmentSchedule.service";
import { ensureChatRoomForAppointment } from "../../../utils/chatRoom";
import { cancelAppointment, requestReschedule } from "../../appointment/appointment.lifecycle";
import { MIN_ADVANCE_HOURS } from "../../../constants/booking";
import logger from "../../../utils/logger";

export function resolveBotAppointmentStart(
  date: string,
  time: string,
  selectedTimeIso?: string,
): Date {
  if (!isValidBookingDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(
      `Data ou horário inválido. Escolha um horário com pelo menos ${MIN_ADVANCE_HOURS} horas de antecedência.`,
    );
  }
  const start = parseLocalAppointmentStart(date, time);
  if (selectedTimeIso !== undefined) {
    // Um ISO sem offset depende do fuso do servidor e não identifica um instante.
    const hasOffset =
      /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
        selectedTimeIso,
      );
    const selected = new Date(selectedTimeIso);
    const isoDay = new Date(`${selectedTimeIso.slice(0, 10)}T12:00:00Z`);
    if (
      !hasOffset ||
      selected.getTime() !== start.getTime() ||
      !Number.isFinite(isoDay.getTime()) ||
      isoDay.toISOString().slice(0, 10) !== selectedTimeIso.slice(0, 10)
    ) {
      throw new Error(
        "O horário enviado não corresponde ao horário confirmado. Escolha novamente.",
      );
    }
  }
  return start;
}

export async function createBotAppointment(
  userId: number,
  ctx: BotSessionContext,
  selectedTimeIso?: string,
): Promise<AppointmentModel> {
  const { serviceId, professionalId, date, time } = ctx;
  if (!serviceId || !professionalId || !date || !time)
    throw new Error("Dados insuficientes para criar agendamento");

  const clientRecord = await ClientModel.findOne({
    where: { user_id: userId },
  });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");

  const [professional, service] = await Promise.all([
    ProfessionalModel.findByPk(professionalId),
    ServiceModel.findByPk(serviceId),
  ]);
  if (!professional) throw new Error("Profissional não encontrado");
  if (!service || !service.active)
    throw new Error("Serviço inativo ou não encontrado");

  if (service.professional_id !== professionalId)
    throw new Error("Serviço não pertence ao profissional selecionado");
  if (!Number.isFinite(service.duration) || service.duration <= 0)
    throw new Error("Duração do serviço inválida");
  const normalizedTime = time.trim();
  const startTime = resolveBotAppointmentStart(
    date,
    normalizedTime,
    selectedTimeIso,
  );
  const endTime = new Date(startTime.getTime() + service.duration * 60000);

  // Endereco provisorio: o principal do cliente ou, na falta, o primeiro
  // cadastrado. O endereco definitivo e escolhido na tela de pagamento.
  const addressId =
    clientRecord.main_address_id ??
    (await AddressModel.findOne({ where: { user_id: userId }, attributes: ["id"] }))?.id;
  if (!addressId) throw new Error("Cadastre um endereço no seu perfil antes de agendar.");
  const appointment = await withProfessionalScheduleLock(
    professionalId,
    async (transaction) => {
      const currentService = await ServiceModel.findByPk(serviceId, {
        transaction,
      });
      if (
        !currentService?.active ||
        currentService.professional_id !== professionalId ||
        currentService.duration !== service.duration
      ) {
        throw new Error("O serviço foi alterado. Escolha o horário novamente.");
      }
      const slots = await getAvailableSlots(
        professionalId,
        date,
        service.duration,
        serviceId,
        { transaction },
      );
      if (!slots.includes(normalizedTime)) {
        throw new Error(
          `Horário ${time} não está mais disponível. Por favor, escolha outro horário.`,
        );
      }
      return AppointmentModel.create(
        {
          professional_id: professionalId,
          client_id: clientRecord.id,
          service_id: serviceId,
          address_id: addressId,
          start_time: startTime,
          end_time: endTime,
          status: "pending",
        },
        { transaction },
      );
    },
  );

  try {
    await ensureChatRoomForAppointment(appointment);
  } catch (e) {
    logger.warn("Bot: falha ao criar chat_room para agendamento", {
      appointmentId: appointment.id,
    });
  }

  try {
    const clientUser = await UserModel.findByPk(clientRecord.user_id);
    const profUser = await UserModel.findByPk(professional.user_id);
    const dateStr = startTime.toLocaleDateString("pt-BR", {
      timeZone: DEFAULT_BOT_TIME_ZONE,
    });
    const timeStr = normalizedTime;

    if (profUser) {
      await NotificationModel.create({
        user_id: profUser.id,
        title: "Novo Agendamento Recebido",
        message: `Agendamento de ${clientUser?.name || "cliente"} para "${service.title}" em ${dateStr} às ${timeStr}.`,
        notification_type: "appointment",
        related_entity_id: appointment.id,
        is_read: false,
      });
    }
    if (clientUser) {
      await NotificationModel.create({
        user_id: clientUser.id,
        title: "Agendamento Criado",
        message: `Seu agendamento para "${service.title}" em ${dateStr} às ${timeStr} foi criado.`,
        notification_type: "appointment",
        related_entity_id: appointment.id,
        is_read: false,
      });
    }
  } catch (e) {
    logger.warn("Bot: falha ao criar notificações do agendamento", {
      appointmentId: appointment.id,
    });
  }

  logger.info("Bot: agendamento criado via chatbot", {
    appointmentId: appointment.id,
    userId,
  });
  return appointment;
}

/**
 * Remarca pelo chatbot.
 * - Reserva ainda nao paga (pre-criada pelo bot): muda o horario na hora, sob a
 *   trava da agenda; identidade e endereco sao preservados.
 * - Reserva paga ou confirmada: segue o mesmo ciclo do app, virando um pedido
 *   de reagendamento que o profissional precisa aceitar (o dinheiro nao muda).
 */
export async function rescheduleBotAppointment(
  userId: number,
  ctx: BotSessionContext,
  selectedTimeIso?: string,
): Promise<AppointmentModel> {
  const client = await ClientModel.findOne({ where: { user_id: userId } });
  if (!client) throw new Error("Usuário não possui perfil de cliente");
  const original = ctx.appointmentId
    ? await AppointmentModel.findByPk(ctx.appointmentId)
    : null;
  if (!original || original.client_id !== client.id)
    throw new Error("Agendamento não encontrado");
  if (
    (ctx.professionalId && ctx.professionalId !== original.professional_id) ||
    (ctx.serviceId && ctx.serviceId !== original.service_id)
  ) {
    throw new Error("A remarcação deve manter o serviço e o profissional originais");
  }
  const date = ctx.newDate ?? ctx.date;
  const time = (ctx.newTime ?? ctx.time)?.trim();
  if (!date || !time) throw new Error("Informe a nova data e horário");
  const start = resolveBotAppointmentStart(date, time, selectedTimeIso);

  if (original.payment_intent_id || original.status === "confirmed") {
    await requestReschedule(userId, String(original.id), start.toISOString());
    const updated = await AppointmentModel.findByPk(original.id);
    if (!updated) throw new Error("Agendamento não encontrado");
    return updated;
  }

  let changed = false;
  const appointment = await withProfessionalScheduleLock(
    original.professional_id,
    async (transaction) => {
      const current = await AppointmentModel.findByPk(original.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!current || current.client_id !== client.id)
        throw new Error("Agendamento não encontrado");
      if (current.status !== "pending" || current.payment_intent_id)
        throw new Error("Este agendamento não pode ser remarcado por aqui");
      // A duração contratada também pertence à reserva, não ao catálogo atual.
      const duration =
        (new Date(current.end_time).getTime() - new Date(current.start_time).getTime()) / 60000;
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error("Duração do agendamento inválida");
      if (new Date(current.start_time).getTime() === start.getTime()) return current;
      const slots = await getAvailableSlots(
        current.professional_id,
        date,
        duration,
        current.service_id,
        { transaction, excludeAppointmentId: current.id },
      );
      if (!slots.includes(time))
        throw new Error("Horário não está mais disponível. Por favor, escolha outro horário.");
      current.start_time = start;
      current.end_time = new Date(start.getTime() + duration * 60000);
      await current.save({ transaction });
      changed = true;
      return current;
    },
  );
  if (changed) {
    logger.info("Bot: reserva não paga remarcada via chatbot", {
      appointmentId: appointment.id,
      userId,
    });
  }
  return appointment;
}

/**
 * Cancela pelo chatbot com a mesma regra do app: aplica a politica de
 * cancelamento e devolve (ou libera) o valor do pagamento.
 */
export async function cancelBotAppointment(
  userId: number,
  appointmentId: number,
): Promise<void> {
  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");
  const appointment = await AppointmentModel.findByPk(appointmentId);
  if (!appointment || appointment.client_id !== clientRecord.id)
    throw new Error("Agendamento não encontrado");
  if (appointment.status === "completed")
    throw new Error("Não é possível cancelar um agendamento já concluído");
  if (appointment.status === "canceled")
    throw new Error("Este agendamento já está cancelado");

  await cancelAppointment(userId, String(appointment.id), "Cancelado pelo assistente virtual");
  logger.info("Bot: agendamento cancelado via chatbot", { appointmentId, userId });
}

import { ClientModel } from "../../../models/Client";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { AppointmentModel } from "../../../models/Appointment";
import { UserModel } from "../../../models/User";
import { NotificationModel } from "../../../models/Notification";
import { BotSessionContext } from "../../../models/BotChatSession";
import { parseLocalAppointmentStart } from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { ensureChatRoomForAppointment } from "../../../utils/chatRoom";
import logger from "../../../utils/logger";

export async function createBotAppointment(
  userId: number,
  ctx: BotSessionContext,
  selectedTimeIso?: string,
): Promise<AppointmentModel> {
  const { serviceId, professionalId, date, time } = ctx;
  if (!serviceId || !professionalId || !date || !time)
    throw new Error("Dados insuficientes para criar agendamento");

  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");

  const [professional, service] = await Promise.all([
    ProfessionalModel.findByPk(professionalId),
    ServiceModel.findByPk(serviceId),
  ]);
  if (!professional) throw new Error("Profissional não encontrado");
  if (!service || !service.active) throw new Error("Serviço inativo ou não encontrado");

  const normalizedTime = time.trim().slice(0, 5);
  let startTime: Date;
  if (selectedTimeIso) {
    const parsed = new Date(selectedTimeIso);
    startTime = isNaN(parsed.getTime())
      ? parseLocalAppointmentStart(date, normalizedTime)
      : parsed;
  } else {
    startTime = parseLocalAppointmentStart(date, normalizedTime);
  }
  const endTime = new Date(startTime.getTime() + service.duration * 60000);

  // Verificação de disponibilidade (double-booking guard)
  const slots = await getAvailableSlots(professionalId, date, service.duration, serviceId);
  if (!slots.includes(normalizedTime)) {
    throw new Error(
      `Horário ${time} não está mais disponível. Por favor, escolha outro horário.`,
    );
  }

  const addressId = clientRecord.main_address_id ?? 1; // fallback
  const appointment = await AppointmentModel.create({
    professional_id: professionalId,
    client_id: clientRecord.id,
    service_id: serviceId,
    address_id: addressId,
    start_time: startTime,
    end_time: endTime,
    status: "pending",
  });

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
      timeZone: "America/Sao_Paulo",
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

export async function cancelBotAppointment(userId: number, appointmentId: number): Promise<void> {
  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");

  const appointment = await AppointmentModel.findByPk(appointmentId, {
    include: [{ model: ServiceModel, as: "Service" }],
  });
  if (!appointment) throw new Error("Agendamento não encontrado");
  if (appointment.client_id !== clientRecord.id)
    throw new Error("Você não tem permissão para cancelar este agendamento");
  if (appointment.status === "completed")
    throw new Error("Não é possível cancelar um agendamento já concluído");
  if (appointment.status === "canceled")
    throw new Error("Este agendamento já está cancelado");

  appointment.status = "canceled";
  await appointment.save();
  logger.info("Bot: agendamento cancelado via chatbot", { appointmentId, userId });
}

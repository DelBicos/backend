import { Op } from "sequelize";
import { ChatRoomModel } from "../models/ChatRoom";
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import logger from "./logger";

const CHAT_SYNC_BATCH_SIZE = 20;

interface AppointmentLike {
  id: number;
  professional_id: number;
  client_id: number;
  service_id: number;
  status?: string;
}

/**
 * Garante que exista uma sala de chat para o agendamento informado.
 * Idempotente: usa findOrCreate sobre appointment_id (único).
 * Nunca lança erro para não bloquear o fluxo de criação do agendamento.
 */
export async function ensureChatRoomForAppointment(
  appointment: AppointmentLike,
): Promise<ChatRoomModel | null> {
  try {
    const [room] = await ChatRoomModel.findOrCreate({
      where: { appointment_id: appointment.id },
      defaults: {
        appointment_id: appointment.id,
        professional_id: appointment.professional_id,
        client_id: appointment.client_id,
        service_id: appointment.service_id,
        status: "active",
      },
    });
    return room;
  } catch (error) {
    logger.error("Erro ao garantir sala de chat para agendamento", {
      appointmentId: appointment.id,
      error,
    });
    return null;
  }
}

/**
 * Arquiva a sala de chat de um agendamento quando ele é finalizado
 * (completed) ou cancelado (canceled). Somente leitura após arquivar.
 */
export async function archiveChatRoomForAppointment(
  appointmentId: number,
): Promise<void> {
  try {
    await ChatRoomModel.update(
      { status: "archived" },
      { where: { appointment_id: appointmentId } },
    );
  } catch (error) {
    logger.error("Erro ao arquivar sala de chat do agendamento", {
      appointmentId,
      error,
    });
  }
}

/**
 * Sincroniza o status da sala conforme o status do agendamento.
 * Arquiva quando completed/canceled/no_show; mantém ativa caso contrário.
 */
export async function syncChatRoomStatusForAppointment(
  appointmentId: number,
  appointmentStatus: string,
): Promise<void> {
  if (
    appointmentStatus === "completed" ||
    appointmentStatus === "canceled" ||
    appointmentStatus === "no_show"
  ) {
    await archiveChatRoomForAppointment(appointmentId);
  }
}

/**
 * Cria salas ausentes para todos os agendamentos do usuário (cliente e/ou profissional).
 * Necessário para agendamentos criados antes do chat ou quando a criação da sala falhou.
 */
export async function syncChatRoomsForUser(userId: number): Promise<void> {
  try {
    const [client, professional] = await Promise.all([
      ClientModel.findOne({ where: { user_id: userId } }),
      ProfessionalModel.findOne({ where: { user_id: userId } }),
    ]);

    const orConditions: Array<Record<string, number>> = [];
    if (client?.id) orConditions.push({ client_id: client.id });
    if (professional?.id)
      orConditions.push({ professional_id: professional.id });

    if (orConditions.length === 0) return;

    const appointments = await AppointmentModel.findAll({
      where: { [Op.or]: orConditions },
      attributes: [
        "id",
        "professional_id",
        "client_id",
        "service_id",
        "status",
      ],
    });

    for (
      let index = 0;
      index < appointments.length;
      index += CHAT_SYNC_BATCH_SIZE
    ) {
      const batch = appointments.slice(index, index + CHAT_SYNC_BATCH_SIZE);

      await Promise.all(
        batch.map(async (appointment) => {
          await ensureChatRoomForAppointment(appointment);
          if (appointment.status) {
            await syncChatRoomStatusForAppointment(
              appointment.id,
              appointment.status,
            );
          }
        }),
      );
    }
  } catch (error) {
    logger.error("Erro ao sincronizar salas de chat do usuário", {
      userId,
      error,
    });
  }
}

/**
 * Retorna o agendamento associado a uma sala (usado por validações de socket).
 */
export async function getAppointmentForRoom(
  roomId: number,
): Promise<AppointmentModel | null> {
  const room = await ChatRoomModel.findByPk(roomId);
  if (!room) return null;
  return AppointmentModel.findByPk(room.appointment_id);
}

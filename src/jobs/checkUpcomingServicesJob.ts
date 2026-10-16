import { Op } from "sequelize";
import { AppointmentModel } from "../models/Appointment";
import { ProfessionalModel } from "../models/Professional";
import { ClientModel } from "../models/Client";
import { UserModel } from "../models/User";
import { ServiceModel } from "../models/Service";
import { NotificationModel } from "../models/Notification";
import { emitAppointmentStatusUpdate } from "../realtime/chatSocket";
import logger, { logError } from "../utils/logger";

export async function checkUpcomingServices(): Promise<number> {
  try {
    const now = new Date();
    // Janela flexível de agora até 75 minutos no futuro (permite testes imediatos de agendamento hoje)
    const windowStart = now;
    const windowEnd = new Date(now.getTime() + 75 * 60 * 1000);

    const upcomingAppointments = await AppointmentModel.findAll({
      where: {
        status: "confirmed",
        start_time: {
          [Op.between]: [windowStart, windowEnd],
        },
      },
      include: [
        { model: ProfessionalModel, as: "Professional", include: [{ model: UserModel, as: "User" }] },
        { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User" }] },
        { model: ServiceModel, as: "Service" },
      ],
    });

    let notifiedCount = 0;

    for (const appointment of upcomingAppointments) {
      const apptData: any = appointment;
      const profUser = apptData.Professional?.User;
      const clientUser = apptData.Client?.User;
      const service = apptData.Service;

      if (!profUser) continue;

      // Evita enviar notificações duplicadas para o mesmo agendamento
      const existingNotification = await NotificationModel.findOne({
        where: {
          user_id: profUser.id,
          title: "Serviço em 1 Hora! ⏰",
          related_entity_id: appointment.id,
        },
      });

      if (!existingNotification) {
        // Notifica o profissional
        await NotificationModel.create({
          user_id: profUser.id,
          title: "Serviço em 1 Hora! ⏰",
          message: `Daqui a 1 hora você tem o serviço '${service?.title || "Agendado"}' com ${clientUser?.name || "Cliente"}. Se prepare!`,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          is_read: false,
        });

        // Notifica o cliente
        if (clientUser) {
          await NotificationModel.create({
            user_id: clientUser.id,
            title: "Lembrete de Serviço ⏰",
            message: `Seu agendamento para o serviço '${service?.title || "Agendado"}' com ${profUser?.name || "Profissional"} é daqui a 1 hora!`,
            notification_type: "appointment",
            related_entity_id: appointment.id,
            is_read: false,
          });
        }

        notifiedCount++;
        logger.info("Notificação de 1h enviada para o agendamento", { appointmentId: appointment.id });
      }
    }

    return notifiedCount;
  } catch (error: any) {
    logError("Erro ao verificar agendamentos próximos de 1 hora", error);
    return 0;
  }
}

export function startUpcomingServicesJob(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  logger.info("Iniciando Job de verificação de serviços próximos (1h antecedência)...");
  checkUpcomingServices();
  return setInterval(checkUpcomingServices, intervalMs);
}

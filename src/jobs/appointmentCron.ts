import cron from 'node-cron';
import { Op } from 'sequelize';
import { AppointmentModel } from '../models/Appointment';
import { NotificationModel } from '../models/Notification';
import { ProfessionalModel } from '../models/Professional';
import { ClientModel } from '../models/Client';
import { UserModel } from '../models/User';
import { ServiceModel } from '../models/Service';
import logger from '../utils/logger';
import { archiveChatRoomForAppointment } from '../utils/chatRoom';
import { syncBotSessionsForAppointmentStatus } from '../services/botAppointmentStatus.service';

export const startAppointmentCron = () => {
  // Roda a cada 10 minutos
  cron.schedule('*/10 * * * *', async () => {
    try {
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

      const expiredAppointments = await AppointmentModel.findAll({
        where: {
          status: 'pending',
          createdAt: {
            [Op.lte]: twelveHoursAgo
          }
        },
        include: [
          { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User" }] },
          { model: ProfessionalModel, as: "Professional", include: [{ model: UserModel, as: "User" }] },
          { model: ServiceModel, as: "Service" }
        ]
      });

      if (expiredAppointments.length === 0) return;

      logger.info(`Encontrados ${expiredAppointments.length} agendamentos expirados.`);

      for (const appointment of expiredAppointments) {
        appointment.status = 'canceled';
        await appointment.save();

        // Arquiva a sala de chat do agendamento cancelado automaticamente
        await archiveChatRoomForAppointment(appointment.id);

        const apptData: any = appointment;
        const clientUser = apptData.Client?.User;
        const professionalUser = apptData.Professional?.User;
        const service = apptData.Service;

        if (clientUser) {
          await NotificationModel.create({
            user_id: clientUser.id,
            title: "Agendamento Expirado",
            message: `O seu agendamento para '${service?.title}' não foi aceito pelo profissional a tempo e foi cancelado automaticamente.`,
            notification_type: "appointment",
            related_entity_id: appointment.id,
            is_read: false,
          });
        }

        if (professionalUser) {
          await NotificationModel.create({
            user_id: professionalUser.id,
            title: "Agendamento Expirado",
            message: `Você não respondeu a solicitação para '${service?.title}' em 12 horas e ela foi cancelada automaticamente.`,
            notification_type: "appointment",
            related_entity_id: appointment.id,
            is_read: false,
          });
        }

        await syncBotSessionsForAppointmentStatus(appointment);
      }
    } catch (error) {
      logger.error('Erro ao executar cron job de agendamentos expirados:', error);
    }
  });
};

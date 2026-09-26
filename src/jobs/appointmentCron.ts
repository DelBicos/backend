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
import { expirePendingAppointment } from '../services/appointmentSchedule.service';
import { processAppointmentRefunds } from '../services/appointmentRefund.service';

export const startAppointmentCron = () => {
  // Roda a cada 10 minutos
  cron.schedule('*/10 * * * *', async () => {
    try {
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

      const expiredAppointments = await AppointmentModel.findAll({
        where: {
          status: 'pending',
          updatedAt: {
            [Op.lte]: twelveHoursAgo
          }
        },
        include: [
          { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User" }] },
          { model: ProfessionalModel, as: "Professional", include: [{ model: UserModel, as: "User" }] },
          { model: ServiceModel, as: "Service" }
        ]
      });

      logger.info(`Encontrados ${expiredAppointments.length} agendamentos expirados.`);

      for (const appointment of expiredAppointments) {
        try {
          // Revalida após adquirir a agenda: uma remarcação ou pagamento pode
          // ter renovado o prazo desde a consulta inicial do job.
          if (!await expirePendingAppointment(appointment, twelveHoursAgo)) continue;

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
              message: `O seu agendamento para '${service?.title}' não foi aceito pelo profissional a tempo e foi cancelado automaticamente.${appointment.payment_intent_id ? " O estorno do pagamento será processado automaticamente." : ""}`,
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
        } catch (error) {
          logger.error('Erro ao expirar agendamento:', { appointmentId: appointment.id, error });
        }
      }
    } catch (error) {
      logger.error('Erro ao executar cron job de agendamentos expirados:', error);
    } finally {
      // A fila deve continuar mesmo sem novas expirações ou se uma notificação falhar.
      try {
        await processAppointmentRefunds();
      } catch (error) {
        logger.error('Erro ao consultar fila de estornos:', error);
      }
    }
  });
};

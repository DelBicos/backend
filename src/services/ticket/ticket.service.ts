import Ticket, { ITicket, TicketUserType } from "../../models/Ticket";
import { ProfessionalModel } from "../../models/Professional";
import { AdminModel } from "../../models/Admin";
import { AppointmentModel } from "../../models/Appointment";
import { generateTicketCode } from "../../utils/ticketCode";
import { CreateTicketInput } from "../../middlewares/ticket.validation";
import TicketMessageModel from "../../models/TicketMessage";
import { UserModel } from "../../models/User";

export const resolveUserType = async (
  userId: number
): Promise<TicketUserType> => {
  const professional = await ProfessionalModel.findOne({
    where: { user_id: userId },
  });
  return professional ? "PRESTADOR" : "CLIENTE";
};

/** Administradores atendem chamados; não abrem chamados (TICKET-02). */
export const isAdmin = async (userId: number): Promise<boolean> => {
  const admin = await AdminModel.findOne({ where: { user_id: userId } });
  return admin !== null;
};

/**
 * Resolve o ID numérico do appointment a partir do short_id.
 * Retorna null se não existir.
 */
const resolveAppointmentId = async (
  shortId?: string
): Promise<number | null> => {
  if (!shortId) return null;

  const appointment = await AppointmentModel.findOne({
    where: { short_id: shortId },
    attributes: ["id"],
  });

  return appointment ? appointment.id : null;
};

export const createTicket = async (
  data: CreateTicketInput,
  userId: number,
  userType: TicketUserType
): Promise<Ticket> => {
  // ✅ Resolve o short_id → id real (FK)
  const appointmentId = await resolveAppointmentId(
    data.appointment_short_id
  );

  // Se o usuário informou um short_id, mas não existe → erro
  if (data.appointment_short_id && !appointmentId) {
    const error = new Error(
      `Agendamento com código ${data.appointment_short_id} não encontrado.`
    );
    (error as Error & { statusCode?: number }).statusCode = 400;

    throw error;
  }

  let ticketCode = generateTicketCode();
  let exists = await Ticket.findOne({
    where: { ticket_code: ticketCode },
  });

  while (exists) {
    ticketCode = generateTicketCode();
    exists = await Ticket.findOne({ where: { ticket_code: ticketCode } });
  }

  const ticket = await Ticket.create({
    ticket_code: ticketCode,
    title: data.title,
    description: data.description,
    category: data.category,
    priority: data.priority,
    status: "ABERTO",
    user_id: userId,
    user_type: userType,
    appointment_id: appointmentId,
  });

  await ticket.reload();
  return ticket;
};

export const listTicketsByUser = async (userId: number): Promise<Ticket[]> => {
  return Ticket.findAll({
    where: { user_id: userId },
    order: [["createdAt", "DESC"]],
  });
};

export const findTicketByIdForUser = async (
  ticketId: number,
  userId: number
): Promise<Ticket | null> => {
  return Ticket.findOne({
    where: {
      id: ticketId,
      user_id: userId,
    },
  });
};

export const listMessagesByTicket = async (
  ticketId: number,
  userId: number
): Promise<TicketMessageModel[] | null> => {
  // 1. Garante ownership
  const ticket = await Ticket.findOne({
    where: { id: ticketId, user_id: userId },
  });

  // null => chamado inexistente ou de outro usuário (controller responde 404)
  if (!ticket) return null;

  // 2. Busca mensagens com dados do autor
  return TicketMessageModel.findAll({
    where: { ticket_id: ticketId },
    order: [["createdAt", "ASC"]],
    include: [
      {
        model: UserModel,
        as: "author",
        attributes: ["id", "name", "avatar_uri"],
      },
    ],
  });
};
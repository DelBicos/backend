import Ticket, { TicketUserType } from "../../models/Ticket";
import { ProfessionalModel } from "../../models/Professional";
import { AdminModel } from "../../models/Admin";
import { AppointmentModel } from "../../models/Appointment";
import { generateTicketCode } from "../../utils/ticketCode";
import {
  CreateTicketInput,
  CreateTicketMessageInput,
} from "../../middlewares/ticket.validation";
import TicketMessageModel from "../../models/TicketMessage";
import { UserModel } from "../../models/User";
import { sequelize } from "../../config/database";
import { HttpError } from "../../errors/HttpError";
import { acceptsNewMessages } from "./ticket.rules";

/** Author data shown in the ticket history (GET and POST /:id/messages). */
const MESSAGE_AUTHOR_INCLUDE = {
  model: UserModel,
  as: "author",
  attributes: ["id", "name", "avatar_uri"],
};

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
    throw HttpError.badRequest(
      `Agendamento com código ${data.appointment_short_id} não encontrado.`
    );
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
    include: [MESSAGE_AUTHOR_INCLUDE],
  });
};

/**
 * TICKET-05: adds a message from the ticket owner to an open ticket.
 *
 * Throws HttpError 404 when the ticket does not exist or belongs to another
 * user, and HttpError 409 (code TICKET_CLOSED) when it is resolved or closed.
 */
export const addMessageToTicket = async (
  ticketId: number,
  userId: number,
  data: CreateTicketMessageInput
): Promise<TicketMessageModel> => {
  const messageId = await sequelize.transaction(async (transaction) => {
    // Row lock: a concurrent status change (e.g. admin closing the ticket)
    // waits, so a message is never saved on a ticket that was just closed.
    const ticket = await Ticket.findOne({
      where: { id: ticketId, user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!ticket) throw HttpError.notFound("Chamado não encontrado.");
    if (!acceptsNewMessages(ticket.status)) {
      throw HttpError.conflict(
        "Chamado encerrado não aceita novas mensagens."
      ).withCode("TICKET_CLOSED");
    }

    const message = await TicketMessageModel.create(
      {
        ticket_id: ticket.id,
        author_id: userId,
        author_type: ticket.user_type,
        content: data.content,
      },
      { transaction }
    );

    // Bumps the ticket updated_at so the list reflects the latest interaction.
    ticket.changed("updatedAt", true);
    await ticket.save({ transaction });

    return message.id;
  });

  const created = await TicketMessageModel.findByPk(messageId, {
    include: [MESSAGE_AUTHOR_INCLUDE],
  });
  if (!created) throw new Error(`Mensagem ${messageId} não encontrada após gravação.`);
  return created;
};
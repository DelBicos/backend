import Ticket, { ITicket, TicketUserType } from "../models/Ticket";
import { ProfessionalModel } from "../models/Professional";
import { generateTicketCode } from "../utils/ticketCode";
import { CreateTicketInput } from "../middlewares/ticket.validation";

export const resolveUserType = async (
  userId: number
): Promise<TicketUserType> => {
  const professional = await ProfessionalModel.findOne({
    where: { user_id: userId },
  });
  return professional ? "PRESTADOR" : "CLIENTE";
};

export const createTicket = async (
  data: CreateTicketInput,
  userId: number,
  userType: TicketUserType
): Promise<Ticket> => {
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
    status: "ABERTO",
    user_id: userId,
    user_type: userType,
    appointment_id: data.appointment_id ?? null,
  });

  await ticket.reload();
  return ticket;
};

export const listTicketsByUser = async (userId: number): Promise<Ticket[]> => {
  return Ticket.findAll({
    where: { user_id: userId },
    order: [["created_at", "DESC"]],
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
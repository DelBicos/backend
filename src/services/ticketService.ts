import { TicketModel, ITicket, TicketUserType } from "../models/TicketModel";
import { ProfessionalModel } from "../models/Professional";
import { generateTicketCode } from "../utils/ticketCode";
import { CreateTicketInput } from "../validators/ticket.validator";

export class TicketService {
  async resolveUserType(userId: number): Promise<TicketUserType> {
    const professional = await ProfessionalModel.findOne({
      where: { user_id: userId },
    });

    return professional ? "PRESTADOR" : "CLIENTE";
  }

  async create(
    data: CreateTicketInput,
    userId: number,
    userType: TicketUserType
  ): Promise<TicketModel> {
    let ticketCode = generateTicketCode();
    let exists = await TicketModel.findOne({
      where: { ticket_code: ticketCode },
    });

    while (exists) {
      ticketCode = generateTicketCode();
      exists = await TicketModel.findOne({
        where: { ticket_code: ticketCode },
      });
    }

    const ticket = await TicketModel.create({
      ticket_code: ticketCode,
      title: data.title,
      description: data.description,
      category: data.category,
      priority: data.priority,
      status: "ABERTO",
      user_id: userId,
      user_type: userType,
      appointment_id: data.appointment_id ?? null,
    });

    return ticket;
  }
}
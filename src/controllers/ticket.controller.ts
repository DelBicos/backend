import { Response } from "express";
import { ZodError } from "zod";
import { TicketService } from "../services/ticketService";
import { createTicketSchema } from "../validators/ticket.validator";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

const ticketService = new TicketService();

export class TicketController {
  async create(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      const userType = await ticketService.resolveUserType(userId);

      const validated = createTicketSchema.parse(req.body);

      const ticket = await ticketService.create(validated, userId, userType);

      return res.status(201).json({
        message: "Chamado aberto com sucesso.",
        ticket: {
          id: ticket.id,
          ticket_code: ticket.ticket_code,
          title: ticket.title,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          created_at: ticket.created_at,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Dados inválidos.",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      console.error("[TicketController.create] Erro:", error);
      return res.status(500).json({
        error: "Erro interno ao criar chamado.",
      });
    }
  }
}
import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import * as ticketService from "../services/ticketService";

/**
 * POST /api/tickets
 */
export const createTicket = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }

    const userType = await ticketService.resolveUserType(userId);
    const ticket = await ticketService.createTicket(req.body, userId, userType);

    return res.status(201).json({
      message: "Chamado aberto com sucesso.",
      ticket: {
        id: ticket.id,
        ticket_code: ticket.ticket_code,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        created_at: ticket.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof Error && (error as any).statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    console.error("[createTicket] Erro:", error);
    return res.status(500).json({ error: "Erro interno ao criar chamado." });
  }
};

/**
 * GET /api/tickets
 */
export const listTickets = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }

    const tickets = await ticketService.listTicketsByUser(userId);

    return res.status(200).json({
      tickets: tickets.map((t) => ({
        id: t.id,
        ticket_code: t.ticket_code,
        title: t.title,
        category: t.category,
        priority: t.priority,
        status: t.status,
        created_at: t.createdAt,   // ✅ camelCase → API snake_case
        updated_at: t.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[listTickets] Erro:", error);
    return res.status(500).json({ error: "Erro ao listar chamados." });
  }
};

/**
 * GET /api/tickets/:id
 */
export const showTicket = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.id;
    const ticketId = Number(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }
    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const ticket = await ticketService.findTicketByIdForUser(ticketId, userId);
    if (!ticket) {
      return res.status(404).json({ error: "Chamado não encontrado." });
    }

    return res.status(200).json({
      ticket: {
        id: ticket.id,
        ticket_code: ticket.ticket_code,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        user_type: ticket.user_type,
        appointment_id: ticket.appointment_id,
        created_at: ticket.createdAt,   // ✅
        updated_at: ticket.updatedAt,
      },
    });
  } catch (error) {
    console.error("[showTicket] Erro:", error);
    return res.status(500).json({ error: "Erro ao buscar chamado." });
  }
};
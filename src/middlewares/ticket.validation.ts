import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

const createTicketSchema = z.object({
  // trim() first: length limits apply to the trimmed text, so a title made
  // only of spaces does not pass.
  title: z
    .string({ message: "Título é obrigatório" })
    .trim()
    .min(5, "Título deve ter no mínimo 5 caracteres")
    .max(100, "Título deve ter no máximo 100 caracteres"),

  description: z
    .string({ message: "Descrição é obrigatória" })
    .trim()
    .min(10, "Descrição deve ter no mínimo 10 caracteres")
    .max(2000, "Descrição deve ter no máximo 2000 caracteres"),

  category: z.enum(
    [
      "AGENDAMENTO",
      "PAGAMENTO",
      "SERVICO",
      "PRESTADOR",
      "CLIENTE",
      "SUGESTAO",
      "OUTROS",
    ],
    { message: "Categoria inválida ou não informada" }
  ),

  priority: z.enum(["BAIXA", "MEDIA", "ALTA", "CRITICA"], {
    message: "Prioridade inválida ou não informada",
  }),

  // short_id do appointment (formato alfanumérico maiúsculo)
  appointment_short_id: z
    .string({ message: "Código do agendamento deve ser texto" })
    .regex(
      /^[A-Z0-9]{4,10}$/,
      "Código do agendamento inválido (esperado 4-10 caracteres alfanuméricos maiúsculos)"
    )
    .optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const validateCreateTicket = (
  req: Request,
  res: Response,
  next: NextFunction
): void | Response => {
  try {
    req.body = createTicketSchema.parse(req.body);
    next();
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
    return res.status(500).json({ error: "Erro na validação." });
  }
};

/** TICKET-05: body of POST /api/tickets/:id/messages. */
const createTicketMessageSchema = z.object({
  content: z
    .string({ message: "Mensagem é obrigatória" })
    .trim()
    .min(1, "Mensagem não pode ficar vazia")
    .max(2000, "Mensagem deve ter no máximo 2000 caracteres"),
});

export type CreateTicketMessageInput = z.infer<typeof createTicketMessageSchema>;

export const validateCreateTicketMessage = (
  req: Request,
  res: Response,
  next: NextFunction
): void | Response => {
  try {
    req.body = createTicketMessageSchema.parse(req.body);
    next();
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
    return res.status(500).json({ error: "Erro na validação." });
  }
};
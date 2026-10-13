import { z } from "zod";

export const createTicketSchema = z.object({
  title: z
    .string({ message: "Título é obrigatório" })
    .min(5, "Título deve ter no mínimo 5 caracteres")
    .max(100, "Título deve ter no máximo 100 caracteres")
    .trim(),

  description: z
    .string({ message: "Descrição é obrigatória" })
    .min(10, "Descrição deve ter no mínimo 10 caracteres")
    .max(2000, "Descrição deve ter no máximo 2000 caracteres")
    .trim(),

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

  appointment_id: z
    .number({ message: "ID do agendamento deve ser um número" })
    .int("ID do agendamento deve ser um número inteiro")
    .positive("ID do agendamento deve ser positivo")
    .optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
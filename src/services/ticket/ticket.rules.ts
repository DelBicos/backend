import type { TicketCategory, TicketPriority, TicketStatus } from "../../models/Ticket";

/** Statuses in which a ticket is still open and accepts new messages (TICKET-05). */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  "ABERTO",
  "EM_ANALISE",
  "EM_ATENDIMENTO",
];

/** A resolved or closed ticket no longer accepts messages. */
export const acceptsNewMessages = (status: TicketStatus): boolean =>
  OPEN_TICKET_STATUSES.includes(status);

/** Limits of the ticket description, the same enforced by POST /api/tickets. */
export const TICKET_DESCRIPTION_MIN_LENGTH = 10;
export const TICKET_DESCRIPTION_MAX_LENGTH = 2000;
const TICKET_TITLE_MAX_LENGTH = 100;

/** Priority of tickets opened by the chatbot; admins re-prioritize in triage. */
export const CHATBOT_TICKET_PRIORITY: TicketPriority = "MEDIA";

/**
 * Keyword rules checked in order: the first match wins. Payment comes first
 * because "cobrança do agendamento" is a payment problem, not a scheduling one.
 */
const CATEGORY_KEYWORD_RULES: ReadonlyArray<readonly [RegExp, TicketCategory]> = [
  [/\b(?:pagamento|pagar|paguei|pix|cartao|boleto|cobranca|cobrad[oa]|cobraram|estorno|reembolso|valor|fatura)\b/, "PAGAMENTO"],
  [/\b(?:prestador|profissional)\b/, "PRESTADOR"],
  [/\b(?:agendamento|agendar|agenda|horario|remarcar|reagendar|cancelamento)\b/, "AGENDAMENTO"],
  [/\b(?:servico|qualidade|mal\s+feito|malfeito|danific\w*|quebr\w*|estrag\w*)\b/, "SERVICO"],
  [/\b(?:conta|cadastro|login|senha|perfil|acesso|acessar|entrar)\b/, "CLIENTE"],
  [/\b(?:sugestao|sugerir|sugiro|melhoria|ideia)\b/, "SUGESTAO"],
];

const normalizeForCategory = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Infers the ticket category from a free-text description; OUTROS by default. */
export const inferTicketCategory = (description: string): TicketCategory => {
  const normalized = normalizeForCategory(description);
  const match = CATEGORY_KEYWORD_RULES.find(([pattern]) => pattern.test(normalized));
  return match ? match[1] : "OUTROS";
};

/**
 * Builds the ticket title from the description, cut at a word boundary.
 * The description has at least 10 characters, so the title always meets the
 * 5-character minimum of the API.
 */
export const buildTicketTitleFromDescription = (description: string): string => {
  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length <= TICKET_TITLE_MAX_LENGTH) return singleLine;

  const cut = singleLine.slice(0, TICKET_TITLE_MAX_LENGTH - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
};

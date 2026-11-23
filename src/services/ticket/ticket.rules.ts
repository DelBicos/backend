import type { TicketStatus } from "../../models/Ticket";

/** Statuses in which a ticket is still open and accepts new messages (TICKET-05). */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  "ABERTO",
  "EM_ANALISE",
  "EM_ATENDIMENTO",
];

/** A resolved or closed ticket no longer accepts messages. */
export const acceptsNewMessages = (status: TicketStatus): boolean =>
  OPEN_TICKET_STATUSES.includes(status);

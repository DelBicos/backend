import type { BotSessionContext } from "../../models/BotChatSession";
import { normalizeText } from "../../utils/nlp.util";

type Query = NonNullable<BotSessionContext["appointmentQuery"]>;
export const APPOINTMENT_QUERY_PAGE_SIZE = 5;

/** Distingue consulta de histórico de comandos que alteram uma reserva. */
export function parseAppointmentQuery(
  message: string,
  previous?: Query,
): Query | null {
  const text = normalizeText(message);
  if (
    /\b(?:cancelar|cancele|cancela|desmarcar|desmarque|anular|desistir|reagendar|reagende|remarcar|remarque|alterar|altere|agendar|agende|marcar|contratar|trocar|mudar)\b/.test(
      text,
    )
  ) {
    return null;
  }
  if (
    /^(?:ver|mostrar)?\s*(?:mais agendamentos|proxima pagina|ver mais|mais)$/.test(
      text,
    )
  ) {
    return previous
      ? {
          ...previous,
          offset:
            previous.offset +
            (previous.hasMore ? APPOINTMENT_QUERY_PAGE_SIZE : 0),
        }
      : null;
  }
  if (/^(?:(?:ver|mostrar)\s+)?(?:pagina anterior|anteriores)$/.test(text)) {
    return previous
      ? {
          ...previous,
          offset: Math.max(0, previous.offset - APPOINTMENT_QUERY_PAGE_SIZE),
        }
      : null;
  }
  const statuses: Query["statuses"] = [];
  if (/\b(?:pendentes?|aguardando confirmacao)\b/.test(text))
    statuses.push("pending");
  if (/\bconfirmad[oa]s?\b/.test(text)) statuses.push("confirmed");
  if (/\b(?:concluid[oa]s?|finalizad[oa]s?|realizad[oa]s?)\b/.test(text))
    statuses.push("completed");
  if (/\b(?:cancelad[oa]s?|desmarcad[oa]s?)\b/.test(text))
    statuses.push("canceled");

  const hasAppointments = /\b(?:agendamentos?|reservas?|compromissos?)\b/.test(
    text,
  );
  const hasServices = /\bservicos?\b/.test(text);
  const asksToRead =
    /\b(?:meus?|minhas?|ver|mostrar|mostre|consultar|listar|quais|todos|todas)\b/.test(
      text,
    );
  const contextualFilter =
    previous &&
    /^(?:(?:e|so|somente|apenas|os|as)\s+)*(?:pendentes?|confirmad[oa]s?|concluid[oa]s?|finalizad[oa]s?|cancelad[oa]s?|todos|todas)$/.test(
      text,
    );
  if (
    (hasAppointments && (asksToRead || statuses.length > 0)) ||
    (hasServices && statuses.length > 0) ||
    contextualFilter
  ) {
    return { statuses, offset: 0, hasMore: false };
  }
  return null;
}

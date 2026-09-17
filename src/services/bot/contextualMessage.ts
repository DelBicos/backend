import { normalizeText } from "../../utils/nlp.util";

/**
 * Identifica um pedido pelos horários livres do dia que já está selecionado no
 * fluxo. Menções aos próprios agendamentos continuam sendo consultas globais.
 */
export function isAvailableTimesQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  if (!/\bhorarios?\b/.test(normalized)) return false;
  if (
    /\b(?:meu|meus|minha|minhas|agendamento|agendamentos)\b/.test(normalized)
  ) {
    return false;
  }

  return (
    /\b(?:qual|quais|mostrar|mostre|listar|liste|ver|veja|tem|ha)\b/.test(
      normalized,
    ) ||
    /\b(?:disponivel|disponiveis|livre|livres|vago|vagos)\b/.test(normalized) ||
    /^(?:os\s+)?horarios?$/.test(normalized)
  );
}

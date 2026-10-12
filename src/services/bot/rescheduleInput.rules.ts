import type { BotSessionContext } from "../../models/BotChatSession";
import { normalizeText } from "../../utils/nlp.util";

/** "Manter" sem complemento se refere à etapa perguntada, nunca confirma a reserva. */
export function parseReschedulePreservation(
  message: string,
  state: string,
  context: BotSessionContext,
): { keepDate: boolean; keepTime: boolean } {
  const text = normalizeText(message);
  if (context.pendingAction !== "RESCHEDULE" || /\bnao\b/.test(text)) {
    return { keepDate: false, keepTime: false };
  }
  const generic = /^(?:(?:eu )?(?:quero|gostaria de|prefiro|vou|pode) )?(?:manter|mantem|mantenha|deixar como esta)$/.test(text);
  const keeping = "(?:manter|mantendo|mantem|mantenha|conservar|continuar com)";
  const qualifiers = "(?:(?:a|o|essa|esse|mesma|mesmo|atual|original) )*";
  const keepDate = new RegExp(`\\b${keeping} ${qualifiers}(?:data|dia)\\b|\\b(?:mesma data|mesmo dia)\\b`).test(text) ||
    /\b(?:so|somente|apenas) (?:quero )?(?:alterar|mudar|trocar) (?:o )?horario\b/.test(text) ||
    /\b(?:alterar|mudar|trocar) (?:so|somente|apenas) (?:o )?horario\b/.test(text) ||
    (generic && state === "COLETANDO_DATA");
  const keepTime = new RegExp(`\\b${keeping} ${qualifiers}(?:hora|horario)\\b|\\bmesm[oa] (?:hora|horario)\\b`).test(text) ||
    /\b(?:so|somente|apenas) (?:quero )?(?:alterar|mudar|trocar) (?:a |o )?(?:data|dia)\b/.test(text) ||
    /\b(?:alterar|mudar|trocar) (?:so|somente|apenas) (?:a |o )?(?:data|dia)\b/.test(text) ||
    (generic && state === "COLETANDO_HORARIO");
  return { keepDate, keepTime };
}

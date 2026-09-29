import { levenshteinDistance } from "../../utils/nlp.util";
import type { NluIntent } from "./types";

export const RESTART_COMMAND_PATTERN =
  /^(?:reiniciar|recomecar|comecar\s+(?:de\s+novo|novamente)|novo\s+(?:atendimento|agendamento|pedido)|iniciar\s+novamente|limpar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|zerar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|cancelar\s+(?:o\s+)?(?:processo|fluxo)|voltar\s+(?:ao\s+)?inicio|sair\s+(?:do\s+)?(?:atendimento|fluxo))$/;

export const EXPLICIT_INTENT_RULES: ReadonlyArray<readonly [RegExp, NluIntent]> = [
  [
    /\b(?:cancelar|cancele|cancela|desmarcar|desmarque|anular|anule|desistir)\b/,
    "CANCELAR",
  ],
  [
    /\b(?:reagendar|reagende|remarcar|remarque|alterar|altere)\b|\b(?:trocar|mudar)\s+(?:(?:a|o)\s+)?(?:data|dia|hora|horario)\b/,
    "ALTERAR",
  ],
  [
    /\b(?:consultar|consulte|acompanhar|acompanhe|ver|veja|mostrar|mostre|listar|liste|conferir|confira)\b.*\b(?:(?:meu|minha|meus|minhas|o|a|os|as|um|uma)\s+)?(?:agenda|agendamento|agendamentos|reserva|reservas|horario|horarios|compromisso|compromissos)\b/,
    "CONSULTAR",
  ],
  [
    /\b(?:agendar|agende|marcar|marque|reservar|reserve|contratar|contrate)\b/,
    "AGENDAR",
  ],
  [
    /\b(?:meu|minha|meus|minhas)\s+(?:agenda|agendamento|agendamentos|reserva|reservas|horario|horarios|horarios\s+marcados|compromisso|compromissos)\b/,
    "CONSULTAR",
  ],
  // `ol` é um erro de digitação comum de `olá`; como a regra está ancorada e
  // exige a palavra inteira, aceitá-lo não amplia a intenção para frases alheias.
  [
    /^(?:oi+|ol+a*|bom\s+dia|boa\s+tarde|boa\s+noite|opa|e\s+ai|hey|ola\s+assistente)\b/,
    "SAUDACAO",
  ],
];


export function normalizeForRules(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const STANDALONE_WEEKDAY_PATTERN =
  /^(?:(?:no|na|para|pra|pro|a)\s+)?(?:(?:proxim[oa]|prox)\s+)?(?:domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab)(?:\s+feira)?(?:\s+(?:(?:que|q)\s+vem|proxim[oa]|(?:da|de)\s+(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)))?$/;
export const STANDALONE_NEXT_WEEK_PATTERN =
  /^(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)(?:\s+(?:na|de))?\s+(?:domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab)(?:\s+feira)?$/;
export const STANDALONE_RELATIVE_DATE_PATTERN =
  /^(?:hoje|hj|amanha|amanh|amnh|(?:depois|dps)\s+(?:de|d)\s+(?:amanha|amanh|amnh))$/;
export const STANDALONE_DAY_PATTERN =
  /^dia\s+(?:\d{1,2}|primeiro|um|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)$/;
export const STANDALONE_WRITTEN_DATE_PATTERN =
  /^(?:dia\s+)?(?:\d{1,2}|primeiro|um|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)\s+(?:de|do|da)\s+(?:janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez|\d{1,2})(?:\s+(?:de|do)\s+\d{2,4})?$/;
export const STANDALONE_TIME_PERIOD_PATTERN =
  /^(?:(?:de|da|pela|na|a)\s+)?(?:manha|matutino|matutina|cedo|manhazinha|tarde|vespertino|vespertina|noite|noturno|noturna|anoitecer)$/;
export const STANDALONE_EXPLICIT_TIME_PATTERN =
  /^(?:(?:as|por\s+volta\s+(?:de|das))\s+)?(?:\d{1,2}(?::\d{1,2})?|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s*(?:h|horas?))?(?:\s+e\s+(?:meia|um\s+quarto|\d{1,2}))?\s+(?:da|de|pela|na|a)\s+(?:manha|tarde|noite)$/;

export function isStandaloneDateInput(message: string): boolean {
  const normalized = normalizeForRules(message);
  return (
    STANDALONE_WEEKDAY_PATTERN.test(normalized) ||
    STANDALONE_NEXT_WEEK_PATTERN.test(normalized) ||
    STANDALONE_RELATIVE_DATE_PATTERN.test(normalized) ||
    STANDALONE_DAY_PATTERN.test(normalized) ||
    STANDALONE_WRITTEN_DATE_PATTERN.test(normalized)
  );
}

export const SCHEDULING_REQUEST_CUES = new Set([
  "quero",
  "queria",
  "preciso",
  "gostaria",
  "desejo",
  "pretendo",
  "pode",
  "podem",
  "vamos",
]);

export const SCHEDULING_ACTION_WORDS = new Set([
  "agenda",
  "agendamento",
  "marca",
  "marcacao",
  "reserva",
  "contrata",
  // Erros curtos e frequentes que exigem duas edições em Levenshtein.
  "ageda",
  "agedar",
  "agnedar",
  "agednar",
]);

export const SCHEDULING_LEAD_WORDS = new Set([
  ...SCHEDULING_ACTION_WORDS,
  "agendar",
  "agende",
  "agendo",
  "marcar",
  "marque",
  "reservar",
  "reserve",
  "contratar",
  "contrate",
]);

/**
 * Aceita uma única inserção, remoção ou troca em "agendar", mas somente para
 * palavras com começo compatível. A restrição evita confundir verbos como
 * "atender", "acender" e "arrendar" com um pedido de agendamento.
 */
export function isSimpleAgendarVariant(word: string): boolean {
  if (SCHEDULING_LEAD_WORDS.has(word)) return true;
  if (!/^(?:ag|aj|ae|an)[a-z]{3,7}$/.test(word)) return false;
  return levenshteinDistance(word, "agendar") <= 1;
}

/**
 * Expõe a mesma política restrita de variações de "agendar" para as etapas
 * do bot que precisam distinguir um comando genérico de um nome de serviço.
 */
export function isSchedulingActionWord(value: string): boolean {
  const normalized = normalizeForRules(value);
  return !normalized.includes(" ") && isSimpleAgendarVariant(normalized);
}

/** Reconhece flexões/erros apenas quando há uma frase clara de solicitação. */
export function isContextualSchedulingRequest(normalized: string): boolean {
  const words = normalized.split(" ").filter(Boolean);
  const hasRequestCue =
    words.some((word) => SCHEDULING_REQUEST_CUES.has(word)) ||
    /\b(?:tem\s+como|da\s+pra)\b/.test(normalized);
  if (!hasRequestCue) return false;

  // Essas construções significam consulta, mesmo contendo "quero" e "agenda".
  if (
    /\b(?:ver|consultar|acompanhar|mostrar|listar|conferir)\b.*\bagenda\b/.test(
      normalized,
    ) ||
    /\bminha\s+agenda\b/.test(normalized)
  ) {
    return false;
  }

  return words.some((word) => isSimpleAgendarVariant(word));
}

export const APPOINTMENT_CONTEXT_PATTERN =
  /\b(?:agenda|agendamento|agendamentos|reserva|reservas|data|dia|hora|horario|horarios|turno|periodo|profissional|prestador|compromisso|compromissos)\b/;

export const ALTERATION_TARGET_WORDS = new Set([
  "agenda",
  "agendamento",
  "agendamentos",
  "reserva",
  "reservas",
  "data",
  "dia",
  "hora",
  "horario",
  "horarios",
  "turno",
  "periodo",
  "profissional",
  "prestador",
  "compromisso",
  "compromissos",
]);

export const UNAMBIGUOUS_ALTER_TYPOS = new Set(["auterar", "alterra"]);
export const CONTEXTUAL_ALTER_TYPOS = new Set(["atera"]);
export const FREQUENT_RESCHEDULE_TYPOS = new Set(["remaca"]);
export const EXCHANGE_WORDS = new Set([
  "trocar",
  "troca",
  "troque",
  "mudar",
  "muda",
  "mude",
]);

/** Considera uma troca entre duas letras vizinhas como um único erro. */
export function isSingleEditVariant(word: string, expected: string): boolean {
  if (levenshteinDistance(word, expected) <= 1) return true;
  if (word.length !== expected.length) return false;

  const mismatches: number[] = [];
  for (let index = 0; index < word.length; index += 1) {
    if (word[index] !== expected[index]) mismatches.push(index);
  }
  return (
    mismatches.length === 2 &&
    mismatches[1] === mismatches[0] + 1 &&
    word[mismatches[0]] === expected[mismatches[1]] &&
    word[mismatches[1]] === expected[mismatches[0]]
  );
}

/**
 * Reconhece erros de uma edição em "cancelar". O prefixo restrito impede que
 * verbos não relacionados, como "contratar", sejam promovidos a cancelamento.
 */
export function isSimpleCancelarVariant(word: string): boolean {
  if (!/^(?:cac|can)[a-z]{3,6}$/.test(word)) return false;
  return isSingleEditVariant(word, "cancelar");
}

/** Erros em flexões curtas só são seguros quando citam o agendamento. */
export function isContextualCancelInflectionVariant(word: string): boolean {
  if (!/^(?:cac|canc|cans)[a-z]{2,5}$/.test(word)) return false;
  return (
    isSingleEditVariant(word, "cancela") || isSingleEditVariant(word, "cancele")
  );
}

export function isSimpleAlterarVariant(word: string): boolean {
  if (!/^a[a-z]{4,7}$/.test(word)) return false;
  return isSingleEditVariant(word, "alterar");
}

/** Reagendar/remarcar são verbos próprios do domínio e seguros isoladamente. */
export function isSimpleRescheduleVariant(word: string): boolean {
  if (FREQUENT_RESCHEDULE_TYPOS.has(word)) return true;
  if (!/^re[a-z]{4,8}$/.test(word)) return false;
  return (
    isSingleEditVariant(word, "reagendar") ||
    isSingleEditVariant(word, "remarcar")
  );
}

/** Trocas só representam alteração quando o objeto é um agendamento. */
export function isSimpleExchangeVariant(word: string): boolean {
  if (EXCHANGE_WORDS.has(word)) return true;
  if (!/^t[a-z]{3,6}$/.test(word)) return false;
  return (
    isSingleEditVariant(word, "trocar") || isSingleEditVariant(word, "troque")
  );
}

/**
 * Distingue um serviço ("troca de pneu") de uma alteração do compromisso
 * ("troca de horário"). A forma curta sem verbo introdutório é aceita porque
 * nomes de serviços são frequentemente enviados sozinhos no chat.
 */
export function isExchangeServiceRequest(normalized: string): boolean {
  const directMatch = normalized.match(/^(?:troca|trocar)\s+de\s+(.+)$/);
  const contextualMatch = normalized.match(
    /^(?:(?:eu\s+)?(?:quero|queria|preciso|gostaria|desejo|pretendo|vamos)|pode|podem|tem\s+como|da\s+pra)\s+(?:de\s+)?(?:fazer\s+)?(?:(?:um|uma|o|a)\s+)?(?:troca|trocar)\s+de\s+(.+)$/,
  );
  const rawObject = directMatch?.[1] ?? contextualMatch?.[1];
  if (!rawObject) return false;

  const objectWords = rawObject.split(" ").filter(Boolean);
  while (/^(?:um|uma|o|a|meu|minha|meus|minhas)$/.test(objectWords[0] ?? "")) {
    objectWords.shift();
  }
  const objectHead = objectWords[0];
  return Boolean(objectHead && !ALTERATION_TARGET_WORDS.has(objectHead));
}

/**
 * Corrige somente verbos de cancelamento/alteração em contexto seguro. Esta
 * etapa antecede CONSULTAR para que "canelar meu agendamento", por exemplo,
 * não seja classificado apenas pela presença de "meu agendamento".
 */
export function classifyCorrectedAppointmentIntent(
  normalized: string,
): NluIntent | null {
  const words = normalized.split(" ").filter(Boolean);
  const hasAppointmentContext = APPOINTMENT_CONTEXT_PATTERN.test(normalized);
  const hasRequestCue =
    words.some((word) => SCHEDULING_REQUEST_CUES.has(word)) ||
    /\b(?:tem\s+como|da\s+pra)\b/.test(normalized);

  if (
    words.some((word) => isSimpleCancelarVariant(word)) ||
    (hasAppointmentContext &&
      words.some((word) => isContextualCancelInflectionVariant(word)))
  ) {
    return "CANCELAR";
  }

  if (
    words.some((word) => isSimpleRescheduleVariant(word)) ||
    words.some((word) => UNAMBIGUOUS_ALTER_TYPOS.has(word))
  ) {
    return "ALTERAR";
  }

  if (
    (hasAppointmentContext || hasRequestCue) &&
    words.some((word) => CONTEXTUAL_ALTER_TYPOS.has(word))
  ) {
    return "ALTERAR";
  }

  if (
    hasAppointmentContext &&
    words.some((word) => isSimpleAlterarVariant(word))
  ) {
    return "ALTERAR";
  }

  if (isExchangeServiceRequest(normalized)) return "AGENDAR";

  if (
    hasAppointmentContext &&
    words.some((word) => isSimpleExchangeVariant(word))
  ) {
    return "ALTERAR";
  }

  return null;
}

/** Identifica frases que encerram o contexto atual e iniciam um novo fluxo. */
export function isRestartCommand(message: string): boolean {
  return RESTART_COMMAND_PATTERN.test(normalizeForRules(message));
}

export function classifyExplicitIntent(message: string): NluIntent | null {
  const normalized = normalizeForRules(message);
  if (!normalized || isRestartCommand(normalized)) return null;

  const correctedAppointmentIntent =
    classifyCorrectedAppointmentIntent(normalized);
  if (correctedAppointmentIntent) return correctedAppointmentIntent;

  let greetingIntent: NluIntent | null = null;
  for (const [pattern, intent] of EXPLICIT_INTENT_RULES) {
    if (!pattern.test(normalized)) continue;
    // Uma saudação pode vir junto do pedido: "oi, quero agenda". Nesse caso,
    // a ação é mais informativa e deve ter prioridade sobre o cumprimento.
    if (intent === "SAUDACAO") {
      greetingIntent = intent;
      continue;
    }
    return intent;
  }
  if (isContextualSchedulingRequest(normalized)) return "AGENDAR";
  return greetingIntent;
}

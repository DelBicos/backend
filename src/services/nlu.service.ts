import {
  parsePortugueseDate,
  parseTimeFromText,
  parseTimePeriodFromText,
  TimePeriod,
} from "../utils/date.util";
import logger from "../utils/logger";
import { levenshteinDistance, normalizeText } from "../utils/nlp.util";

/** Tempo máximo de espera pelo classificador interno em milissegundos. */
const configuredTimeoutMs = Number(
  process.env.NLU_CLASSIFIER_TIMEOUT_MS ?? 1000,
);
const NLU_TIMEOUT_MS =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 1000;
const NLU_SERVICE_URL = (
  process.env.NLU_SERVICE_URL ?? "http://nlu-service:8000"
).replace(/\/$/, "");

const VALID_INTENTS = new Set([
  "AGENDAR",
  "ALTERAR",
  "CANCELAR",
  "CONSULTAR",
  "SAUDACAO",
  "FALLBACK",
]);

export type NluIntent =
  "AGENDAR" | "ALTERAR" | "CANCELAR" | "CONSULTAR" | "SAUDACAO" | "FALLBACK";

export interface NluEntities {
  service?: string;
  date?: string;
  time?: string;
  time_period?: TimePeriod;
  professional?: string;
  appointment_id?: number;
  /** Origem da entrada, por exemplo web, voice-web ou voice-mobile. */
  input_channel?: string;
}

export interface NluResult {
  intent: NluIntent;
  entities: NluEntities;
  confidence: number;
}

/**
 * Comandos explícitos do domínio. As regras validam ou corrigem a classificação
 * de frases inequívocas, mas não impedem que o texto passe pelo TF-IDF + SVM.
 */
const RESTART_COMMAND_PATTERN =
  /^(?:reiniciar|recomecar|comecar\s+(?:de\s+novo|novamente)|novo\s+(?:atendimento|agendamento|pedido)|iniciar\s+novamente|limpar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|zerar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|cancelar\s+(?:o\s+)?(?:processo|fluxo)|voltar\s+(?:ao\s+)?inicio|sair\s+(?:do\s+)?(?:atendimento|fluxo))$/;

const EXPLICIT_INTENT_RULES: ReadonlyArray<readonly [RegExp, NluIntent]> = [
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

interface ClassifierResponse {
  intent?: unknown;
  confidence?: unknown;
  model_version?: unknown;
}

function fallback(entities: NluEntities = {}, confidence = 0): NluResult {
  return { intent: "FALLBACK", entities, confidence };
}

function normalizeForRules(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SCHEDULING_REQUEST_CUES = new Set([
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

const SCHEDULING_ACTION_WORDS = new Set([
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

const SCHEDULING_LEAD_WORDS = new Set([
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
function isSimpleAgendarVariant(word: string): boolean {
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
function isContextualSchedulingRequest(normalized: string): boolean {
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

const APPOINTMENT_CONTEXT_PATTERN =
  /\b(?:agenda|agendamento|agendamentos|reserva|reservas|data|dia|hora|horario|horarios|turno|periodo|profissional|prestador|compromisso|compromissos)\b/;

const ALTERATION_TARGET_WORDS = new Set([
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

const UNAMBIGUOUS_ALTER_TYPOS = new Set(["auterar", "alterra"]);
const CONTEXTUAL_ALTER_TYPOS = new Set(["atera"]);
const FREQUENT_RESCHEDULE_TYPOS = new Set(["remaca"]);
const EXCHANGE_WORDS = new Set([
  "trocar",
  "troca",
  "troque",
  "mudar",
  "muda",
  "mude",
]);

/** Considera uma troca entre duas letras vizinhas como um único erro. */
function isSingleEditVariant(word: string, expected: string): boolean {
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
function isSimpleCancelarVariant(word: string): boolean {
  if (!/^(?:cac|can)[a-z]{3,6}$/.test(word)) return false;
  return isSingleEditVariant(word, "cancelar");
}

/** Erros em flexões curtas só são seguros quando citam o agendamento. */
function isContextualCancelInflectionVariant(word: string): boolean {
  if (!/^(?:cac|canc|cans)[a-z]{2,5}$/.test(word)) return false;
  return (
    isSingleEditVariant(word, "cancela") || isSingleEditVariant(word, "cancele")
  );
}

function isSimpleAlterarVariant(word: string): boolean {
  if (!/^a[a-z]{4,7}$/.test(word)) return false;
  return isSingleEditVariant(word, "alterar");
}

/** Reagendar/remarcar são verbos próprios do domínio e seguros isoladamente. */
function isSimpleRescheduleVariant(word: string): boolean {
  if (FREQUENT_RESCHEDULE_TYPOS.has(word)) return true;
  if (!/^re[a-z]{4,8}$/.test(word)) return false;
  return (
    isSingleEditVariant(word, "reagendar") ||
    isSingleEditVariant(word, "remarcar")
  );
}

/** Trocas só representam alteração quando o objeto é um agendamento. */
function isSimpleExchangeVariant(word: string): boolean {
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
function isExchangeServiceRequest(normalized: string): boolean {
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
function classifyCorrectedAppointmentIntent(
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

function classifyExplicitIntent(message: string): NluIntent | null {
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

function extractDate(message: string, timeZone?: string): string | undefined {
  return parsePortugueseDate(message, { timeZone }) ?? undefined;
}

function extractTime(message: string): string | undefined {
  // parseTimeFromText foi concebida para uma resposta curta do usuário. Em uma
  // frase inteira, priorizamos o trecho que contém a indicação de horário.
  const numeric = message.match(/\b\d{1,2}(?::\d{2}|h\d{1,2})\b/i);
  if (numeric) return parseTimeFromText(numeric[0]) ?? undefined;

  const afterTimeMarker = message.match(
    /(?:^|\s)(?:às|as|por volta de)\s+(.+)$/i,
  );
  if (afterTimeMarker)
    return parseTimeFromText(afterTimeMarker[1]) ?? undefined;
  return parseTimeFromText(message) ?? undefined;
}

function extractServiceCandidate(message: string): string | undefined {
  const decodedMessage = message.replace(
    /(?:&nbsp;|&#0*32;|&#x0*20;|&#0*160;|&#x0*a0;)/gi,
    " ",
  );
  const patterns = [
    /^\s*((?:troca|trocar)\s+de\s+.+)$/i,
    /\b(?:agendar|marcar|contratar|reservar|chamar)\s+(?:(?:um|uma|o|a)\s+)?(.+)$/i,
    /\b(?:quero|preciso|gostaria|desejo)\s+(?:de\s+)?(?:(?:um|uma|o|a)\s+)?(.+)$/i,
  ];
  const raw = patterns
    .map((pattern) => decodedMessage.match(pattern)?.[1])
    .find(Boolean);
  if (!raw) return undefined;

  let candidate = raw
    .replace(/^(?:um|uma|o|a)\s+/i, "")
    .replace(
      /\s+(?:(?:para|no|na|em)\s+)?(?:hoje|hj|amanh[ãa]|amnh|depois\s+de\s+amanh[ãa]|dps\s+de\s+amanh[ãa]|pr[oó]x(?:ima)?\s+)?(?:segunda|seg|ter[cç]a|ter|quarta|qua|quinta|qui|sexta|sex|s[aá]bado|sab|domingo|dom)(?:-?feira)?(?:\s+(?:que|q)\s+vem)?.*$/i,
      "",
    )
    .replace(
      /\s+(?:(?:para|no|na|em)\s+)?(?:dia\s+)?(?:\d{1,2}|primeiro|um|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)(?:\s+e\s+\w+)?(?:\s*(?:\/|\.|-)|\s+(?:de|do|da)\s+).+$/i,
      "",
    )
    .replace(/\s+(?:dia\s+\d{1,2}|hoje|hj|amanh[ãa]|amnh)(?:\s|$).*$/i, "")
    .replace(/(?:[àa]s?)\s+\d{1,2}(?::\d{2})?(?:\s*(?:h|horas))?.*$/i, "")
    .replace(/\s+(?:de|da|pela|na)\s+(?:manh[ãa]|tarde|noite).*$/i, "")
    .replace(/\s+(?:por\s+favor|porfavor|pfv|por\s+gentileza|gentileza|obrigad[oa])$/i, "")
    .trim()
    .replace(/[,.!?]+$/, "");

  candidate = candidate.replace(/^trocar\s+de\s+/i, "troca de ");

  // Quando a pessoa escreve "quero agenda limpeza" ou erra "agendar", a
  // primeira palavra representa a ação, não o nome do serviço.
  const candidateWords = candidate.split(/\s+/).filter(Boolean);
  const firstWord = normalizeForRules(candidateWords[0] ?? "");
  if (isSimpleAgendarVariant(firstWord)) {
    candidateWords.shift();
    if (/^(?:um|uma|o|a)$/.test(normalizeForRules(candidateWords[0] ?? ""))) {
      candidateWords.shift();
    }
    candidate = candidateWords.join(" ").trim();
  } else if (
    /^(?:novo|nova)$/.test(firstWord) &&
    isSimpleAgendarVariant(normalizeForRules(candidateWords[1] ?? ""))
  ) {
    candidate = candidateWords.slice(2).join(" ").trim();
  } else if (/^(?:fazer|iniciar)$/.test(firstWord)) {
    let actionIndex = 1;
    if (
      /^(?:um|uma|o|a)$/.test(
        normalizeForRules(candidateWords[actionIndex] ?? ""),
      )
    ) {
      actionIndex += 1;
    }
    if (
      /^(?:novo|nova)$/.test(
        normalizeForRules(candidateWords[actionIndex] ?? ""),
      )
    ) {
      actionIndex += 1;
    }
    if (
      normalizeForRules(candidateWords[actionIndex] ?? "") === "agendamento"
    ) {
      actionIndex += 1;
      if (
        /^(?:de|para)$/.test(
          normalizeForRules(candidateWords[actionIndex] ?? ""),
        )
      ) {
        actionIndex += 1;
      }
      candidate = candidateWords.slice(actionIndex).join(" ").trim();
    }
  }

  candidate = candidate
    .replace(/^(?:de|para)\s+/i, "")
    .replace(/\s+(?:na(?:\s+minha)?|minha|em\s+minha)\s+agenda.*$/i, "")
    .replace(/\s+(?:de|para)$/i, "")
    .replace(/^(?:de|para)$/i, "")
    .trim();

  const genericTerms = new Set([
    "",
    "servico",
    "serviço",
    "um serviço",
    "uma ajuda",
    "ajuda",
    "agendamento",
    "agenda",
    "ageda",
    "agedar",
    "meu agendamento",
    "minha agenda",
    "novo agendamento",
    "nova agenda",
    "horario",
    "horário",
    "agendar",
    "marcar",
    "reservar",
    "contratar",
    "chamar",
  ]);
  if (genericTerms.has(normalizeForRules(candidate))) return undefined;
  if (
    parsePortugueseDate(candidate) ||
    parseTimePeriodFromText(candidate) ||
    parseTimeFromText(candidate)
  ) {
    return undefined;
  }
  return candidate.slice(0, 200);
}

function extractEntities(
  message: string,
  intent: NluIntent,
  timeZone?: string,
): NluEntities {
  const entities: NluEntities = {};
  const trimmed = message.trim();

  if (intent === "AGENDAR" || intent === "ALTERAR") {
    const date = extractDate(trimmed, timeZone);
    if (date) entities.date = date;
    const time = extractTime(trimmed);
    if (time) entities.time = time;
    const timePeriod = parseTimePeriodFromText(trimmed);
    if (timePeriod) entities.time_period = timePeriod;
  }

  if (intent === "AGENDAR") {
    const service = extractServiceCandidate(trimmed);
    if (service) entities.service = service;
  }

  if (intent === "ALTERAR" || intent === "CANCELAR") {
    const idMatch = trimmed.match(
      /\b(?:id|agendamento|n[uú]mero)?\s*#?\s*(\d+)\b/i,
    );
    if (idMatch) {
      const appointmentId = Number(idMatch[1]);
      if (Number.isInteger(appointmentId) && appointmentId > 0) {
        entities.appointment_id = appointmentId;
      }
    }
  }

  return entities;
}

/**
 * Entradas estruturadas são tratadas por regras porque pertencem aos estados do
 * fluxo, não ao problema de classificação de intenção. Mensagens abertas sempre
 * seguem para TF-IDF + SVM.
 */
function classifyStructuredInput(
  message: string,
  timeZone?: string,
): NluResult | null {
  const normalized = message.toLowerCase().trim();
  const normalizedWords = normalizeText(message);
  if (
    /^(?:sim|s|nao|n|ok|confirmar|confirmo|confirmado|pode|pode ser|vamos|fechado|combinado|aceito|blz|vlw|obrigado|obrigada)$/.test(
      normalizedWords,
    )
  ) {
    return fallback({}, 1);
  }

  if (/^\d+$/.test(normalized)) {
    const id = Number(normalized);
    return fallback(id > 10 ? { appointment_id: id } : {}, 1);
  }

  if (/^\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?$/.test(normalized)) {
    return fallback(
      { date: extractDate(normalized, timeZone) ?? normalized },
      1,
    );
  }
  if (/^\d{1,2}:\d{2}$/.test(normalized)) {
    return fallback({ time: extractTime(normalized) ?? normalized }, 1);
  }
  return null;
}

function validIntent(value: unknown): NluIntent {
  return typeof value === "string" && VALID_INTENTS.has(value)
    ? (value as NluIntent)
    : "FALLBACK";
}

function validConfidence(value: unknown): number {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
}

/**
 * Classifica uma mensagem por TF-IDF + SVM no serviço Python interno e combina
 * o resultado com entidades extraídas exclusivamente por regras locais.
 */
export async function analyzeMessage(
  message: string,
  sessionContext?: Record<string, unknown>,
): Promise<NluResult> {
  const timeZone =
    typeof sessionContext?.timeZone === "string"
      ? sessionContext.timeZone
      : undefined;
  const structuredResult = classifyStructuredInput(message, timeZone);
  if (structuredResult) return structuredResult;

  const explicitIntent = classifyExplicitIntent(message);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NLU_TIMEOUT_MS);
  try {
    const response = await fetch(`${NLU_SERVICE_URL}/classify`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!response.ok) {
      logger.warn("NLU: classificador interno indisponível", {
        status: response.status,
      });
      if (!explicitIntent) return fallback();

      logger.info("NLU: regra explícita usada como contingência", {
        ruleIntent: explicitIntent,
      });
      return {
        intent: explicitIntent,
        confidence: 1,
        entities: extractEntities(message, explicitIntent, timeZone),
      };
    }

    const payload = (await response.json()) as ClassifierResponse;
    const modelIntent = validIntent(payload.intent);
    const modelConfidence = validConfidence(payload.confidence);
    const ruleOverridesModel =
      explicitIntent !== null && explicitIntent !== modelIntent;
    const intent = ruleOverridesModel ? explicitIntent : modelIntent;
    const confidence = ruleOverridesModel ? 1 : modelConfidence;
    const decisionSource = ruleOverridesModel
      ? "explicit-rule-override"
      : explicitIntent
        ? "svm-rule-validated"
        : "svm";
    logger.info("NLU: intenção classificada por TF-IDF + SVM", {
      intent,
      confidence,
      modelIntent,
      modelConfidence,
      ruleIntent: explicitIntent ?? undefined,
      decisionSource,
      modelVersion:
        typeof payload.model_version === "string"
          ? payload.model_version
          : undefined,
    });
    return {
      intent,
      confidence,
      entities: extractEntities(message, intent, timeZone),
    };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : "erro de conexão";
    logger.warn("NLU: classificador interno indisponível", { reason });
    if (!explicitIntent) return fallback();

    logger.info("NLU: regra explícita usada como contingência", {
      ruleIntent: explicitIntent,
      reason,
    });
    return {
      intent: explicitIntent,
      confidence: 1,
      entities: extractEntities(message, explicitIntent, timeZone),
    };
  } finally {
    clearTimeout(timeout);
  }
}

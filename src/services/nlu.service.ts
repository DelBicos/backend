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

/** Identifica frases que encerram o contexto atual e iniciam um novo fluxo. */
export function isRestartCommand(message: string): boolean {
  return RESTART_COMMAND_PATTERN.test(normalizeForRules(message));
}

function classifyExplicitIntent(message: string): NluIntent | null {
  const normalized = normalizeForRules(message);
  if (!normalized || isRestartCommand(normalized)) return null;

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
    .trim()
    .replace(/[,.!?]+$/, "");

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

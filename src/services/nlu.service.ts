import {
  parsePortugueseDate,
  parseTimeFromText,
  parseTimePeriodFromText,
  TimePeriod,
} from "../utils/date.util";
import logger from "../utils/logger";

/** Tempo máximo de espera pelo classificador interno em milissegundos. */
const configuredTimeoutMs = Number(process.env.NLU_CLASSIFIER_TIMEOUT_MS ?? 1000);
const NLU_TIMEOUT_MS = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : 1000;
const NLU_SERVICE_URL = (process.env.NLU_SERVICE_URL ?? "http://nlu-service:8000").replace(/\/$/, "");

const VALID_INTENTS = new Set([
  "AGENDAR",
  "ALTERAR",
  "CANCELAR",
  "CONSULTAR",
  "SAUDACAO",
  "FALLBACK",
]);

export type NluIntent =
  | "AGENDAR"
  | "ALTERAR"
  | "CANCELAR"
  | "CONSULTAR"
  | "SAUDACAO"
  | "FALLBACK";

export interface NluEntities {
  service?: string;
  date?: string;
  time?: string;
  time_period?: TimePeriod;
  professional?: string;
  appointment_id?: number;
}

export interface NluResult {
  intent: NluIntent;
  entities: NluEntities;
  confidence: number;
}

/**
 * Comandos explícitos do domínio. Eles preservam um comportamento previsível
 * para frases curtas; mensagens abertas seguem para a classificação TF-IDF +
 * SVM normalmente.
 */
const RESTART_COMMAND_PATTERN = /^(?:reiniciar|recomecar|comecar\s+(?:de\s+novo|novamente)|novo\s+(?:atendimento|agendamento|pedido)|iniciar\s+novamente|limpar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|zerar\s+(?:o\s+)?(?:chat|bate\s*papo|conversa)|cancelar\s+(?:o\s+)?(?:processo|fluxo)|voltar\s+(?:ao\s+)?inicio|sair\s+(?:do\s+)?(?:atendimento|fluxo))$/;

const EXPLICIT_INTENT_RULES: ReadonlyArray<readonly [RegExp, NluIntent]> = [
  [/\b(?:cancelar|cancele|cancela|desmarcar|desmarque|anular|anule|desistir)\b/, "CANCELAR"],
  [/\b(?:reagendar|reagende|remarcar|remarque|alterar|altere)\b|\b(?:trocar|mudar)\s+(?:(?:a|o)\s+)?(?:data|dia|hora|horario)\b/, "ALTERAR"],
  [/\b(?:meus|minhas)\s+(?:agendamentos|reservas|horarios|horarios\s+marcados|compromissos)\b|\b(?:consultar|acompanhar|ver|mostrar|listar|conferir)\s+(?:meus|minhas|os)\s*(?:agendamentos|reservas|horarios|compromissos)\b/, "CONSULTAR"],
  [/\b(?:agendar|agende|marcar|marque|reservar|reserve|contratar|contrate)\b/, "AGENDAR"],
  [/^(?:oi+|ola+|bom\s+dia|boa\s+tarde|boa\s+noite|opa|e\s+ai|hey|ola\s+assistente)\b/, "SAUDACAO"],
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

/** Identifica frases que encerram o contexto atual e iniciam um novo fluxo. */
export function isRestartCommand(message: string): boolean {
  return RESTART_COMMAND_PATTERN.test(normalizeForRules(message));
}

function classifyExplicitIntent(message: string): NluIntent | null {
  const normalized = normalizeForRules(message);
  if (!normalized || isRestartCommand(normalized)) return null;

  for (const [pattern, intent] of EXPLICIT_INTENT_RULES) {
    if (pattern.test(normalized)) return intent;
  }
  return null;
}

function extractDate(message: string, timeZone?: string): string | undefined {
  return parsePortugueseDate(message, { timeZone }) ?? undefined;
}

function extractTime(message: string): string | undefined {
  // parseTimeFromText foi concebida para uma resposta curta do usuário. Em uma
  // frase inteira, priorizamos o trecho que contém a indicação de horário.
  const numeric = message.match(/\b\d{1,2}(?::\d{2}|h\d{1,2})\b/i);
  if (numeric) return parseTimeFromText(numeric[0]) ?? undefined;

  const afterTimeMarker = message.match(/(?:às|as|por volta de)\s+(.+)$/i);
  if (afterTimeMarker) return parseTimeFromText(afterTimeMarker[1]) ?? undefined;
  return parseTimeFromText(message) ?? undefined;
}

function extractServiceCandidate(message: string): string | undefined {
  const patterns = [
    /\b(?:agendar|marcar|contratar|reservar|chamar)\s+(?:(?:um|uma|o|a)\s+)?(.+)$/i,
    /\b(?:quero|preciso|gostaria|desejo)\s+(?:de\s+)?(?:(?:um|uma|o|a)\s+)?(.+)$/i,
  ];
  const raw = patterns.map((pattern) => message.match(pattern)?.[1]).find(Boolean);
  if (!raw) return undefined;

  const candidate = raw
    .replace(/^(?:um|uma|o|a)\s+/i, "")
    .replace(/\s+(?:(?:para|no|na|em)\s+)?(?:hoje|hj|amanh[ãa]|amnh|depois\s+de\s+amanh[ãa]|dps\s+de\s+amanh[ãa]|pr[oó]x(?:ima)?\s+)?(?:segunda|seg|ter[cç]a|ter|quarta|qua|quinta|qui|sexta|sex|s[aá]bado|sab|domingo|dom)(?:-?feira)?(?:\s+(?:que|q)\s+vem)?.*$/i, "")
    .replace(/\s+(?:(?:para|no|na|em)\s+)?(?:dia\s+)?(?:\d{1,2}|primeiro|um|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)(?:\s+e\s+\w+)?(?:\s*(?:\/|\.|-)|\s+(?:de|do|da)\s+).+$/i, "")
    .replace(/\s+(?:dia\s+\d{1,2}|hoje|hj|amanh[ãa]|amnh)(?:\s|$).*$/i, "")
    .replace(/(?:[àa]s?)\s+\d{1,2}(?::\d{2})?(?:\s*(?:h|horas))?.*$/i, "")
    .replace(/\s+(?:de|da|pela|na)\s+(?:manh[ãa]|tarde|noite).*$/i, "")
    .trim()
    .replace(/[,.!?]+$/, "");

  const genericTerms = new Set([
    "", "servico", "serviço", "um serviço", "uma ajuda", "ajuda", "agendamento", "horario", "horário",
    "agendar", "marcar", "reservar", "contratar", "chamar",
  ]);
  return genericTerms.has(candidate.toLowerCase()) ? undefined : candidate.slice(0, 200);
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
    const idMatch = trimmed.match(/\b(?:id|agendamento|n[uú]mero)?\s*#?\s*(\d+)\b/i);
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
function classifyStructuredInput(message: string, timeZone?: string): NluResult | null {
  const normalized = message.toLowerCase().trim();
  if (/^(sim|s|n[aã]o|n|ok|confirmar|confirmado|blz|vlw|obrigado|obrigada)$/i.test(normalized)) {
    return fallback({}, 1);
  }

  if (/^\d+$/.test(normalized)) {
    const id = Number(normalized);
    return fallback(id > 10 ? { appointment_id: id } : {}, 1);
  }

  if (/^\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?$/.test(normalized)) {
    return fallback({ date: extractDate(normalized, timeZone) ?? normalized }, 1);
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
  if (explicitIntent) {
    return {
      intent: explicitIntent,
      confidence: 1,
      entities: extractEntities(message, explicitIntent, timeZone),
    };
  }

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
      logger.warn("NLU: classificador interno indisponível", { status: response.status });
      return fallback();
    }

    const payload = (await response.json()) as ClassifierResponse;
    const intent = validIntent(payload.intent);
    const confidence = validConfidence(payload.confidence);
    logger.info("NLU: intenção classificada por TF-IDF + SVM", {
      intent,
      confidence,
      modelVersion: typeof payload.model_version === "string" ? payload.model_version : undefined,
    });
    return { intent, confidence, entities: extractEntities(message, intent, timeZone) };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : "erro de conexão";
    logger.warn("NLU: classificador interno indisponível", { reason });
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}

import { parseTimePeriodFromText } from "../utils/date.util";
import { normalizeText } from "../utils/nlp.util";
import logger from "../utils/logger";
import type { NluEntities, NluIntent, NluResult } from "./nlu/nlu.types";
import { STANDALONE_EXPLICIT_TIME_PATTERN, STANDALONE_TIME_PERIOD_PATTERN, classifyExplicitIntent, isStandaloneDateInput } from "./nlu/intent.rules";
import { extractDate, extractEntities, extractTime } from "./nlu/entities.rules";

export type { NluIntent, NluEntities, NluResult } from "./nlu/nlu.types";
export { isSchedulingActionWord, isRestartCommand } from "./nlu/intent.rules";

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
const NLU_SERVICE_API_KEY = process.env.NLU_SERVICE_API_KEY ?? "";

const VALID_INTENTS = new Set([
  "AGENDAR",
  "ALTERAR",
  "CANCELAR",
  "CONSULTAR",
  "SAUDACAO",
  "FALLBACK",
]);

interface ClassifierResponse {
  intent?: unknown;
  confidence?: unknown;
  model_version?: unknown;
}

function fallback(entities: NluEntities = {}, confidence = 0): NluResult {
  return { intent: "FALLBACK", entities, confidence };
}

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
  if (isStandaloneDateInput(message)) {
    const date = extractDate(message, timeZone);
    if (date) return fallback({ date }, 1);
  }
  const parsedTime = extractTime(message);
  if (parsedTime && STANDALONE_EXPLICIT_TIME_PATTERN.test(normalizedWords)) {
    const timePeriod = parseTimePeriodFromText(message);
    return fallback(
      {
        time: parsedTime,
        ...(timePeriod ? { time_period: timePeriod } : {}),
      },
      1,
    );
  }
  if (STANDALONE_TIME_PERIOD_PATTERN.test(normalizedWords)) {
    const timePeriod = parseTimePeriodFromText(message);
    if (timePeriod) return fallback({ time_period: timePeriod }, 1);
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
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": NLU_SERVICE_API_KEY,
      },
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
  } catch (error) {
    const reason = (error instanceof Error && error.name === "AbortError") ? "timeout" : "erro de conexão";
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

import logger from "../utils/logger";

const configuredTimeoutMs = Number(process.env.SEMANTIC_SEARCH_TIMEOUT_MS ?? 5000);
const SEMANTIC_SEARCH_TIMEOUT_MS =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 5000;
const NLU_SERVICE_URL = (process.env.NLU_SERVICE_URL ?? "http://nlu-service:8000").replace(/\/$/, "");
const NLU_MAX_CANDIDATES_PER_REQUEST = 500;
const MAX_SEMANTIC_RESULTS = 500;

function readScore(value: string | undefined, fallback: number): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(1, Math.max(-1, score)) : fallback;
}

/** Limiar único para catálogo e chatbot; ajuste após avaliar consultas reais. */
export const SEMANTIC_MIN_SCORE = readScore(process.env.SEMANTIC_MIN_SCORE, 0.35);
const configuredResultLimit = Number(process.env.SEMANTIC_SEARCH_RESULT_LIMIT ?? 200);
export const SEMANTIC_SEARCH_RESULT_LIMIT = Number.isFinite(configuredResultLimit)
  ? Math.min(MAX_SEMANTIC_RESULTS, Math.max(50, Math.floor(configuredResultLimit)))
  : 200;

export interface SemanticSearchCandidate {
  id: number;
  text: string;
}

export interface SemanticSearchHit {
  id: number;
  score: number;
}

interface SemanticSearchPayload {
  results?: unknown;
}

/** Indica que a infraestrutura semântica falhou, sem expor o erro ao cliente. */
export class SemanticSearchUnavailableError extends Error {
  public constructor(message = "Busca semântica indisponível") {
    super(message);
    this.name = "SemanticSearchUnavailableError";
  }
}

function isValidHit(value: unknown): value is SemanticSearchHit {
  if (!value || typeof value !== "object") return false;
  const hit = value as Record<string, unknown>;
  return (
    Number.isInteger(hit.id) &&
    typeof hit.score === "number" &&
    Number.isFinite(hit.score) &&
    hit.score >= -1 &&
    hit.score <= 1
  );
}

async function rankCandidateBatch(
  query: string,
  candidates: SemanticSearchCandidate[],
  options: { limit: number; minScore: number },
): Promise<SemanticSearchHit[]> {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEMANTIC_SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${NLU_SERVICE_URL}/semantic-search`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        candidates,
        limit: options.limit,
        min_score: options.minScore,
      }),
    });
    if (!response.ok) {
      logger.warn("Busca semântica: nlp-service retornou erro", {
        status: response.status,
      });
      throw new SemanticSearchUnavailableError();
    }

    const payload = (await response.json()) as SemanticSearchPayload;
    if (!Array.isArray(payload.results)) {
      throw new SemanticSearchUnavailableError("Resposta semântica inválida");
    }

    const seenIds = new Set<number>();
    return payload.results.filter((hit): hit is SemanticSearchHit => {
      if (!isValidHit(hit) || !candidateIds.has(hit.id) || seenIds.has(hit.id)) {
        return false;
      }
      seenIds.add(hit.id);
      return true;
    });
  } catch (error: unknown) {
    if (error instanceof SemanticSearchUnavailableError) throw error;
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "erro de conexão";
    logger.warn("Busca semântica: nlp-service indisponível", { reason });
    throw new SemanticSearchUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Solicita ao nlp-service apenas o ranking. Os documentos continuam vindo do
 * banco pelo back-end principal, portanto o serviço Python não acessa dados
 * nem aplica regras de autorização.
 */
export async function rankSemanticCandidates(
  query: string,
  candidates: SemanticSearchCandidate[],
  options: { limit?: number; minScore?: number } = {},
): Promise<SemanticSearchHit[]> {
  const validCandidates = candidates.filter(
    (candidate) =>
      Number.isInteger(candidate.id) && candidate.id > 0 && candidate.text.trim().length > 0,
  );
  if (validCandidates.length === 0) return [];

  const requestOptions = {
    limit: Math.min(MAX_SEMANTIC_RESULTS, Math.max(1, options.limit ?? 20)),
    minScore: readScore(options.minScore?.toString(), SEMANTIC_MIN_SCORE),
  };
  const batches: SemanticSearchCandidate[][] = [];
  for (let index = 0; index < validCandidates.length; index += NLU_MAX_CANDIDATES_PER_REQUEST) {
    batches.push(validCandidates.slice(index, index + NLU_MAX_CANDIDATES_PER_REQUEST));
  }

  // O nlp-service compartilha um único modelo pesado. Processar lotes em
  // sequência evita picos de CPU/RAM quando o catálogo crescer.
  const hits: SemanticSearchHit[] = [];
  for (const batch of batches) {
    hits.push(...await rankCandidateBatch(query, batch, requestOptions));
  }
  return hits
    .flat()
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .slice(0, requestOptions.limit);
}

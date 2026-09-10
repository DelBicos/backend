import logger from "../utils/logger";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;
const DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS = 20_000;
const GEMINI_MAX_ATTEMPTS = 2;
const GEMINI_RETRY_DELAY_MS = 250;

type VoiceTranscriptionProvider = "gemini" | "openai-compatible" | "deepgram" | "mock";

interface ResolvedProvider {
  provider: VoiceTranscriptionProvider;
  endpoint: string;
  apiKey?: string;
  model: string;
}

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/3gpp",
  "audio/3gpp2",
  "audio/aac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);

export class VoiceTranscriptionConfigurationError extends Error {
  public constructor() {
    super("Serviço de transcrição não configurado");
    this.name = "VoiceTranscriptionConfigurationError";
  }
}

export class VoiceTranscriptionProviderError extends Error {
  public constructor() {
    super("Não foi possível transcrever o áudio");
    this.name = "VoiceTranscriptionProviderError";
  }
}

export class VoiceTranscriptionRateLimitError extends Error {
  public constructor() {
    super("Limite de requisições de transcrição excedido");
    this.name = "VoiceTranscriptionRateLimitError";
  }
}

function readEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isGeminiModel(model: string | undefined): boolean {
  return Boolean(model && /^(?:models\/)?gemini(?:[-_.]|$)/i.test(model));
}

function normalizeGeminiModel(model: string | undefined): string {
  const normalized = model?.replace(/^models\//i, "");
  return isGeminiModel(normalized) ? normalized! : DEFAULT_GEMINI_MODEL;
}

function geminiEndpoint(model: string, apiKey?: string): string {
  const baseUrl = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  return apiKey ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
}

function resolveExplicitProvider(value: string): VoiceTranscriptionProvider {
  switch (value.trim().toLowerCase()) {
    case "gemini":
    case "google":
    case "google-gemini":
      return "gemini";
    case "deepgram":
    case "deep-gram":
      return "deepgram";
    case "generic":
    case "openai":
    case "openai-compatible":
      return "openai-compatible";
    case "mock":
    case "test":
    case "local":
      return "mock";
    default:
      throw new VoiceTranscriptionConfigurationError();
  }
}

function resolveProvider(): ResolvedProvider {
  const explicitProvider = readEnvironment("VOICE_TRANSCRIPTION_PROVIDER");
  const endpoint = readEnvironment("VOICE_TRANSCRIPTION_URL");
  const voiceApiKey = readEnvironment("VOICE_TRANSCRIPTION_API_KEY");
  const voiceModel = readEnvironment("VOICE_TRANSCRIPTION_MODEL");
  const legacyModel = readEnvironment("OPENAI_MODEL");
  const legacyApiKey = readEnvironment("OPENAI_API_KEY");
  const deepgramApiKey =
    readEnvironment("DEEPGRAM_API_KEY") ||
    (explicitProvider === "deepgram" ? voiceApiKey || legacyApiKey : undefined);
  const geminiApiKey =
    voiceApiKey ||
    readEnvironment("GEMINI_API_KEY") ||
    readEnvironment("GOOGLE_API_KEY") ||
    legacyApiKey;

  if (explicitProvider) {
    const provider = resolveExplicitProvider(explicitProvider);
    if (provider === "mock") {
      return {
        provider: "mock",
        endpoint: "mock",
        model: "mock",
      };
    }
    if (provider === "deepgram") {
      if (!deepgramApiKey) throw new VoiceTranscriptionConfigurationError();
      return {
        provider,
        endpoint: endpoint || "https://api.deepgram.com/v1/listen",
        apiKey: deepgramApiKey,
        model: voiceModel || "nova-2",
      };
    }
    if (provider === "openai-compatible") {
      const openAiApiKey = voiceApiKey || legacyApiKey;
      if (!openAiApiKey) throw new VoiceTranscriptionConfigurationError();
      return {
        provider,
        endpoint: endpoint || "https://api.openai.com/v1/audio/transcriptions",
        apiKey: openAiApiKey,
        model: voiceModel || legacyModel || "whisper-1",
      };
    }

    if (!geminiApiKey) throw new VoiceTranscriptionConfigurationError();
    const model = normalizeGeminiModel(
      isGeminiModel(voiceModel) ? voiceModel : legacyModel,
    );
    return {
      provider,
      endpoint: endpoint || geminiEndpoint(model, geminiApiKey),
      apiKey: geminiApiKey,
      model,
    };
  }

  if (deepgramApiKey) {
    return {
      provider: "deepgram",
      endpoint: endpoint || "https://api.deepgram.com/v1/listen",
      apiKey: deepgramApiKey,
      model: voiceModel || "nova-2",
    };
  }

  // Um endpoint configurado preserva integralmente o provedor multipart já
  // existente. A detecção do Gemini só ocorre quando não há endpoint genérico.
  if (endpoint) {
    return {
      provider: "openai-compatible",
      endpoint,
      apiKey: voiceApiKey,
      model: voiceModel || "whisper-1",
    };
  }

  if (geminiApiKey) {
    const model = normalizeGeminiModel(
      isGeminiModel(voiceModel) ? voiceModel : legacyModel,
    );
    return {
      provider: "gemini",
      endpoint: geminiEndpoint(model, geminiApiKey),
      apiKey: geminiApiKey,
      model,
    };
  }

  const env = readEnvironment("ENVIRONMENT") || readEnvironment("NODE_ENV");
  if (env === "development") {
    return {
      provider: "mock",
      endpoint: "mock",
      model: "mock",
    };
  }

  throw new VoiceTranscriptionConfigurationError();
}

function extensionForMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    "audio/3gpp": "3gp",
    "audio/3gpp2": "3g2",
    "audio/aac": "aac",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-m4a": "m4a",
    "audio/x-wav": "wav",
  };
  return extensions[mimeType] ?? "webm";
}

function hasIsoBaseMediaFileSignature(audio: Buffer): boolean {
  return audio.byteLength >= 8 && audio.toString("ascii", 4, 8) === "ftyp";
}

function normalizeGeminiMimeType(audio: Buffer, mimeType: string): string {
  // Expo pode devolver um arquivo M4A/MP4 com o MIME genérico audio/mpeg.
  // O box `ftyp` corrige somente esse caso ambíguo; 3GPP genuíno também usa
  // ISO BMFF e precisa manter o MIME original.
  if (mimeType.toLowerCase() === "audio/mpeg" && hasIsoBaseMediaFileSignature(audio)) {
    return "audio/mp4";
  }

  switch (mimeType.toLowerCase()) {
    case "audio/m4a":
    case "audio/x-m4a":
      return "audio/mp4";
    case "audio/x-wav":
      return "audio/wav";
    default:
      return mimeType.toLowerCase();
  }
}

function readPositiveTimeout(name: string, fallback: number): number {
  const configuredValue = Number(readEnvironment(name));
  return Number.isFinite(configuredValue) && configuredValue > 0
    ? configuredValue
    : fallback;
}

function cleanTranscription(text: string): string | null {
  const cleaned = text.replace(/[^\P{C}\n\t]/gu, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function readDeepgramText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const results = (payload as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return null;
  const channels = (results as Record<string, unknown>).channels;
  if (!Array.isArray(channels) || channels.length === 0) return null;
  const firstChannel = channels[0];
  if (!firstChannel || typeof firstChannel !== "object") return null;
  const alternatives = (firstChannel as Record<string, unknown>).alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) return null;
  const firstAlt = alternatives[0];
  if (!firstAlt || typeof firstAlt !== "object") return null;
  const transcript = (firstAlt as Record<string, unknown>).transcript;
  return typeof transcript === "string" ? cleanTranscription(transcript) : null;
}

function readOpenAiCompatibleText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === "string" ? cleanTranscription(text) : null;
}

function readGeminiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const firstCandidate = candidates[0];
  if (!firstCandidate || typeof firstCandidate !== "object") return null;
  const content = (firstCandidate as Record<string, unknown>).content;
  if (!content || typeof content !== "object") return null;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map((part) =>
      part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
        ? ((part as Record<string, unknown>).text as string)
        : "",
    )
    .filter(Boolean)
    .join("\n");
  return cleanTranscription(text);
}

function createGeminiRequest(audio: Buffer, mimeType: string): string {
  return JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcreva este áudio em português do Brasil. Retorne somente as palavras faladas, sem explicações, títulos, formatação, aspas ou comentários. Preserve nomes próprios e números como foram ditos.",
          },
          {
            inlineData: {
              mimeType,
              data: audio.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  });
}

async function requestProvider(
  config: ResolvedProvider,
  init: RequestInit,
  mimeType: string,
  bytes: number,
  readText: (response: Response) => Promise<string | null>,
  deadline: number,
  geminiAttemptTimeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  const maxAttempts = config.provider === "gemini" ? GEMINI_MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingTotalMs = deadline - Date.now();
    if (remainingTotalMs <= 0) throw new VoiceTranscriptionProviderError();

    const attemptTimeoutMs = Math.min(
      config.provider === "gemini" ? geminiAttemptTimeoutMs : remainingTotalMs,
      remainingTotalMs,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

    try {
      const response = await fetch(config.endpoint, {
        ...init,
        signal: controller.signal,
      });
      logger.info("Transcrição de voz: resposta do provedor", {
        provider: config.provider,
        status: response.status,
        mimeType,
        bytes,
        durationMs: Date.now() - startedAt,
        attempt,
      });
      const isTransientGeminiFailure =
        config.provider === "gemini" && response.status === 503;
      if (!isTransientGeminiFailure || attempt === maxAttempts) {
        if (!response.ok) {
          const errText = typeof response.text === "function" ? await response.text().catch(() => "") : "";
          logger.warn("Transcrição de voz: provedor retornou erro HTTP", {
            provider: config.provider,
            status: response.status,
            errorBody: errText.slice(0, 500),
          });
          if (response.status === 429) {
            throw new VoiceTranscriptionRateLimitError();
          }
          throw new VoiceTranscriptionProviderError();
        }

        const text = await readText(response);
        if (!text) throw new VoiceTranscriptionProviderError();
        return text;
      }
    } catch (error) {
      if (error instanceof VoiceTranscriptionProviderError) throw error;

      const isTimeout =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const cause =
        error && typeof error === "object"
          ? (error as { cause?: { code?: unknown }; code?: unknown }).cause
          : undefined;
      const connectionCode =
        cause && typeof cause === "object" ? cause.code : (error as { code?: unknown })?.code;
      const isTransientConnectionError =
        isTimeout ||
        error instanceof TypeError ||
        (typeof connectionCode === "string" &&
          [
            "EAI_AGAIN",
            "ECONNREFUSED",
            "ECONNRESET",
            "ENETUNREACH",
            "ENOTFOUND",
            "ETIMEDOUT",
            "UND_ERR_CONNECT_TIMEOUT",
            "UND_ERR_HEADERS_TIMEOUT",
            "UND_ERR_SOCKET",
          ].includes(connectionCode));

      logger.warn("Transcrição de voz: provedor indisponível", {
        provider: config.provider,
        status: "network_error",
        mimeType,
        bytes,
        durationMs: Date.now() - startedAt,
        attempt,
        reason: isTimeout ? "timeout" : "connection_error",
      });

      if (
        config.provider !== "gemini" ||
        !isTransientConnectionError ||
        attempt === maxAttempts
      ) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    // A espera também consome o orçamento total. Se ele acabar aqui, nenhuma
    // nova chamada é iniciada com um signal já vencido.
    const remainingBeforeRetryMs = deadline - Date.now();
    if (remainingBeforeRetryMs <= 0) throw new VoiceTranscriptionProviderError();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(GEMINI_RETRY_DELAY_MS, remainingBeforeRetryMs)),
    );
  }

  // O laço sempre retorna ou lança; este erro mantém a função total para o TS.
  throw new VoiceTranscriptionProviderError();
}

async function callProvider(
  config: ResolvedProvider,
  audio: Buffer,
  mimeType: string,
  language: string,
  deadline: number,
  geminiAttemptTimeoutMs: number,
): Promise<string> {
  if (config.provider === "mock") {
    logger.info("Transcrição de voz: usando provedor mock para ambiente local");
    return "Quero agendar um serviço de faxina";
  }

  if (config.provider === "gemini") {
    const geminiMimeType = normalizeGeminiMimeType(audio, mimeType);
    return requestProvider(
      config,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey!,
        },
        body: createGeminiRequest(audio, geminiMimeType),
      },
      geminiMimeType,
      audio.byteLength,
      async (response) => readGeminiText(await response.json()),
      deadline,
      geminiAttemptTimeoutMs,
    );
  }

  if (config.provider === "deepgram") {
    const lang = language === "pt" || language === "pt-BR" ? "pt-BR" : language;
    const url = `${config.endpoint}?model=${encodeURIComponent(config.model)}&language=${encodeURIComponent(lang)}&smart_formatting=true`;
    const audioBytes = new Uint8Array(audio.byteLength);
    audioBytes.set(audio);
    return requestProvider(
      { ...config, endpoint: url },
      {
        method: "POST",
        headers: {
          Authorization: `Token ${config.apiKey}`,
          "Content-Type": mimeType,
        },
        body: audioBytes,
      },
      mimeType,
      audio.byteLength,
      async (response) => readDeepgramText(await response.json()),
      deadline,
      geminiAttemptTimeoutMs,
    );
  }

  const formData = new FormData();
  // Copia para ArrayBuffer próprio, compatível com Blob tanto nos tipos do
  // TypeScript quanto no runtime Node. O Buffer original é limpo pelo controller.
  const audioBytes = new Uint8Array(audio.byteLength);
  audioBytes.set(audio);
  const blob = new Blob([audioBytes.buffer], { type: mimeType });
  formData.append("file", blob, `voice-command.${extensionForMimeType(mimeType)}`);
  formData.append("model", config.model);
  formData.append("language", language);
  formData.append("response_format", "json");

  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return requestProvider(
    config,
    {
      method: "POST",
      headers,
      body: formData,
    },
    mimeType,
    audio.byteLength,
    async (response) => readOpenAiCompatibleText(await response.json()),
    deadline,
    geminiAttemptTimeoutMs,
  );
}

/**
 * Converte áudio em texto. Mantém compatibilidade com endpoints multipart no
 * formato OpenAI e também usa a API REST generateContent do Gemini diretamente.
 * Credenciais permanecem exclusivamente no backend.
 */
export async function transcribeVoiceAudio(
  audio: Buffer,
  mimeType: string,
  language = "pt",
): Promise<string> {
  const config = resolveProvider();
  const totalTimeoutMs = readPositiveTimeout(
    "VOICE_TRANSCRIPTION_TIMEOUT_MS",
    DEFAULT_TOTAL_TIMEOUT_MS,
  );
  const geminiAttemptTimeoutMs = readPositiveTimeout(
    "VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS",
    DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS,
  );
  const deadline = Date.now() + totalTimeoutMs;

  try {
    return await callProvider(
      config,
      audio,
      mimeType,
      language,
      deadline,
      geminiAttemptTimeoutMs,
    );
  } catch (error) {
    if (
      error instanceof VoiceTranscriptionConfigurationError ||
      error instanceof VoiceTranscriptionProviderError ||
      error instanceof VoiceTranscriptionRateLimitError
    ) {
      throw error;
    }
    throw new VoiceTranscriptionProviderError();
  }
}

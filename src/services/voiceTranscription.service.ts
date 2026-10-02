import logger from "../utils/logger";

const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;

type VoiceTranscriptionProvider = "azure" | "openai-compatible" | "deepgram" | "mock";

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

export class VoiceUnclearAudioError extends Error {
  public constructor() {
    super("Não foi possível entender o áudio");
    this.name = "VoiceUnclearAudioError";
  }
}
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

function resolveExplicitProvider(value: string): VoiceTranscriptionProvider {
  switch (value.trim().toLowerCase()) {
    case "azure":
    case "azure-speech":
    case "azure-stt":
      return "azure";
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
  const azureApiKey =
    readEnvironment("AZURE_SPEECH_KEY") ||
    readEnvironment("AZURE_SPEECH_API_KEY") ||
    readEnvironment("AZURE_KEYVAULT_SPEECH_KEY") ||
    (explicitProvider === "azure" ? voiceApiKey || legacyApiKey : undefined);
  const azureRegion =
    readEnvironment("AZURE_SPEECH_REGION") || "brazilsouth";
  const deepgramApiKey =
    readEnvironment("DEEPGRAM_API_KEY") ||
    (explicitProvider === "deepgram" ? voiceApiKey || legacyApiKey : undefined);

  if (explicitProvider) {
    const provider = resolveExplicitProvider(explicitProvider);
    if (provider === "mock") {
      return {
        provider: "mock",
        endpoint: "mock",
        model: "mock",
      };
    }
    if (provider === "azure") {
      if (!azureApiKey) throw new VoiceTranscriptionConfigurationError();
      return {
        provider,
        endpoint: endpoint || `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
        apiKey: azureApiKey,
        model: voiceModel || azureRegion,
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

    const openAiApiKey = voiceApiKey || legacyApiKey;
    if (!openAiApiKey) throw new VoiceTranscriptionConfigurationError();
    return {
      provider,
      endpoint: endpoint || "https://api.openai.com/v1/audio/transcriptions",
      apiKey: openAiApiKey,
      model: voiceModel || legacyModel || "whisper-1",
    };
  }

  if (azureApiKey) {
    return {
      provider: "azure",
      endpoint: endpoint || `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
      apiKey: azureApiKey,
      model: voiceModel || azureRegion,
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

  if (endpoint) {
    return {
      provider: "openai-compatible",
      endpoint,
      apiKey: voiceApiKey,
      model: voiceModel || "whisper-1",
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

function readAzureSpeechText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const status = (payload as Record<string, unknown>).RecognitionStatus;
  if (status !== "Success") return null;

  const displayText = (payload as Record<string, unknown>).DisplayText;
  if (typeof displayText === "string") {
    const cleaned = cleanTranscription(displayText);
    if (cleaned) return cleaned;
  }

  const nbest = (payload as Record<string, unknown>).NBest;
  if (Array.isArray(nbest) && nbest.length > 0) {
    const first = nbest[0];
    if (first && typeof first === "object") {
      const display =
        (first as Record<string, unknown>).Display ||
        (first as Record<string, unknown>).Lexical;
      if (typeof display === "string") return cleanTranscription(display);
    }
  }

  return null;
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

async function requestProvider(
  config: ResolvedProvider,
  init: RequestInit,
  mimeType: string,
  bytes: number,
  readText: (response: Response) => Promise<string | null>,
  deadline: number,
): Promise<string> {
  const startedAt = Date.now();
  const remainingTotalMs = deadline - Date.now();
  if (remainingTotalMs <= 0) throw new VoiceTranscriptionProviderError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingTotalMs);

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
      attempt: 1,
    });

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
    if (!text) throw new VoiceUnclearAudioError();
    return text;
  } catch (error) {
    if (
      error instanceof VoiceUnclearAudioError ||
      error instanceof VoiceTranscriptionProviderError ||
      error instanceof VoiceTranscriptionRateLimitError
    ) {
      throw error;
    }

    const isTimeout =
      controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    logger.warn("Transcrição de voz: provedor indisponível", {
      provider: config.provider,
      status: "network_error",
      mimeType,
      bytes,
      durationMs: Date.now() - startedAt,
      attempt: 1,
      reason: isTimeout ? "timeout" : "connection_error",
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callProvider(
  config: ResolvedProvider,
  audio: Buffer,
  mimeType: string,
  language: string,
  deadline: number,
): Promise<string> {
  if (config.provider === "mock") {
    logger.info("Transcrição de voz: usando provedor mock para ambiente local");
    return "Quero agendar um serviço de faxina";
  }

  if (config.provider === "azure") {
    const lang = language === "pt" || language === "pt-BR" ? "pt-BR" : language;
    const url = `${config.endpoint}?language=${encodeURIComponent(lang)}&format=detailed`;
    const audioBytes = new Uint8Array(audio.byteLength);
    audioBytes.set(audio);

    let azureContentType = mimeType;
    if (mimeType === "audio/webm") azureContentType = "audio/webm; codecs=opus";
    else if (mimeType === "audio/ogg") azureContentType = "audio/ogg; codecs=opus";
    else if (mimeType === "audio/wav" || mimeType === "audio/x-wav") azureContentType = "audio/wav";
    else if (mimeType === "audio/mp3" || mimeType === "audio/mpeg") azureContentType = "audio/mp3";

    return requestProvider(
      { ...config, endpoint: url },
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.apiKey!,
          "Content-Type": azureContentType,
          Accept: "application/json",
        },
        body: audioBytes,
      },
      mimeType,
      audio.byteLength,
      async (response) => readAzureSpeechText(await response.json()),
      deadline,
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
  );
}

/**
 * Converte áudio em texto. Suporta o provedor Deepgram nativamente e qualquer
 * endpoint multipart no formato OpenAI (ex.: Whisper). Credenciais permanecem
 * exclusivamente no backend.
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
  const deadline = Date.now() + totalTimeoutMs;

  try {
    return await callProvider(config, audio, mimeType, language, deadline);
  } catch (error) {
    if (
      (error instanceof VoiceTranscriptionProviderError || error instanceof VoiceTranscriptionRateLimitError) &&
      config.provider !== "deepgram" &&
      config.provider !== "mock"
    ) {
      const deepgramApiKey = readEnvironment("DEEPGRAM_API_KEY");
      if (deepgramApiKey) {
        logger.warn(`Transcrição de voz: erro no provedor principal (${config.provider}), acionando fallback para Deepgram...`, {
          error: (error as Error).message,
        });
        const fallbackConfig: ResolvedProvider = {
          provider: "deepgram",
          endpoint: readEnvironment("VOICE_TRANSCRIPTION_URL") || "https://api.deepgram.com/v1/listen",
          apiKey: deepgramApiKey,
          model: readEnvironment("VOICE_TRANSCRIPTION_MODEL") || "nova-2",
        };
        try {
          return await callProvider(fallbackConfig, audio, mimeType, language, deadline);
        } catch (fallbackError) {
          logger.warn("Transcrição de voz: fallback para Deepgram também falhou", {
            error: (fallbackError as Error).message,
          });
        }
      }
    }

    if (
      error instanceof VoiceTranscriptionConfigurationError ||
      error instanceof VoiceUnclearAudioError ||
      error instanceof VoiceTranscriptionProviderError ||
      error instanceof VoiceTranscriptionRateLimitError
    ) {
      throw error;
    }
    throw new VoiceTranscriptionProviderError();
  }
}

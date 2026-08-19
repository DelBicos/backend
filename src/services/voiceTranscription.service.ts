const configuredTimeoutMs = Number(process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS ?? 20_000);
const VOICE_TRANSCRIPTION_TIMEOUT_MS =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 20_000;

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

function readProviderText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const text = (payload as Record<string, unknown>).text;
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/[^\P{C}\n\t]/gu, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Converte áudio em texto usando um endpoint compatível com o formato
 * multipart de transcrição. O provedor é definido por ambiente para evitar
 * chave de API no aplicativo e para permitir trocar o motor no futuro.
 */
export async function transcribeVoiceAudio(
  audio: Buffer,
  mimeType: string,
  language = "pt",
): Promise<string> {
  const endpoint = process.env.VOICE_TRANSCRIPTION_URL?.trim();
  if (!endpoint) throw new VoiceTranscriptionConfigurationError();

  const model = process.env.VOICE_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
  const formData = new FormData();
  // Copia para ArrayBuffer próprio, compatível com Blob tanto nos tipos do
  // TypeScript quanto no runtime Node. O Buffer original é limpo pelo controller.
  const audioBytes = new Uint8Array(audio.byteLength);
  audioBytes.set(audio);
  const blob = new Blob([audioBytes.buffer], { type: mimeType });
  formData.append("file", blob, `voice-command.${extensionForMimeType(mimeType)}`);
  formData.append("model", model);
  formData.append("language", language);
  formData.append("response_format", "json");

  const headers: Record<string, string> = {};
  const apiKey = process.env.VOICE_TRANSCRIPTION_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_TRANSCRIPTION_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: formData,
    });
    if (!response.ok) throw new VoiceTranscriptionProviderError();

    const text = readProviderText(await response.json());
    if (!text) throw new VoiceTranscriptionProviderError();
    return text;
  } catch (error) {
    if (
      error instanceof VoiceTranscriptionConfigurationError ||
      error instanceof VoiceTranscriptionProviderError
    ) {
      throw error;
    }
    throw new VoiceTranscriptionProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

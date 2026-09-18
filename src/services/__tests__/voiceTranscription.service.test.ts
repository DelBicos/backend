jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import logger from "../../utils/logger";
import {
  transcribeVoiceAudio,
  VoiceTranscriptionConfigurationError,
  VoiceTranscriptionProviderError,
  VoiceTranscriptionRateLimitError,
} from "../voiceTranscription.service";

describe("transcribeVoiceAudio", () => {
  const originalFetch = (global as any).fetch;
  const originalEnv = { ...process.env };
  const configurationVariables = [
    "VOICE_TRANSCRIPTION_PROVIDER",
    "VOICE_TRANSCRIPTION_URL",
    "VOICE_TRANSCRIPTION_API_KEY",
    "VOICE_TRANSCRIPTION_MODEL",
    "DEEPGRAM_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "VOICE_TRANSCRIPTION_TIMEOUT_MS",
  ];

  beforeEach(() => {
    for (const variable of configurationVariables) delete process.env[variable];
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("exige uma configuração de transcrição reconhecida", async () => {
    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionConfigurationError,
    );
  });

  it("preserva o provedor multipart OpenAI-compatible quando há endpoint", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    process.env.VOICE_TRANSCRIPTION_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "custom-model";
    process.env.OPENAI_API_KEY = "legacy-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: "quero agendar uma limpeza" }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).resolves.toBe(
      "quero agendar uma limpeza",
    );

    const [, request] = (global as any).fetch.mock.calls[0];
    expect((global as any).fetch).toHaveBeenCalledWith(
      "https://voice.example.test/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get("model")).toBe("whisper-1");
  });

  it("usa o provider Deepgram quando DEEPGRAM_API_KEY está definido", async () => {
    process.env.DEEPGRAM_API_KEY = "deepgram-key";
    process.env.VOICE_TRANSCRIPTION_MODEL = "nova-2";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: { channels: [{ alternatives: [{ transcript: "quero agendar" }] }] },
      }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).resolves.toBe(
      "quero agendar",
    );

    const [url, request] = (global as any).fetch.mock.calls[0];
    expect(url).toContain("https://api.deepgram.com/v1/listen?model=nova-2");
    expect(request.headers).toEqual({
      Authorization: "Token deepgram-key",
      "Content-Type": "audio/wav",
    });
  });

  it("rejeita 'gemini' como provider explícito (removido do sistema)", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).rejects.toBeInstanceOf(
      VoiceTranscriptionConfigurationError,
    );
  });

  it("rejeita provider explícito desconhecido como erro de configuração", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "desconhecido";

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).rejects.toBeInstanceOf(
      VoiceTranscriptionConfigurationError,
    );
  });

  it("lança VoiceTranscriptionRateLimitError ao receber 429", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: async () => "Quota exceeded" });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionRateLimitError,
    );
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("não repete uma falha 503 (sem retry desde a remoção do provedor Gemini)", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionProviderError,
    );
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("não repete exceções de rede do provider multipart", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionProviderError,
    );
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("normaliza falhas HTTP sem vazar detalhes do provedor", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toEqual(
      new VoiceTranscriptionProviderError(),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Transcrição de voz: resposta do provedor",
      expect.objectContaining({ status: 401, mimeType: "audio/webm", bytes: 5 }),
    );
  });
});

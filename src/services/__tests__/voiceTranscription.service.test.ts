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
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "VOICE_TRANSCRIPTION_TIMEOUT_MS",
    "VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS",
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
    process.env.OPENAI_MODEL = "gemini-flash-latest";
    process.env.OPENAI_API_KEY = "legacy-gemini-key";
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

  it("detecta a credencial Gemini legada e ignora o default whisper", async () => {
    process.env.VOICE_TRANSCRIPTION_MODEL = "whisper-1";
    process.env.OPENAI_MODEL = "gemini-flash-latest";
    process.env.OPENAI_API_KEY = "legacy-gemini-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
      }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).resolves.toBe(
      "Quero agendar",
    );

    const [url, request] = (global as any).fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=legacy-gemini-key",
    );
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "legacy-gemini-key",
    });
    expect(body.contents[0].parts[0].text).toContain("português do Brasil");
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: {
        mimeType: "audio/webm",
        data: Buffer.from("audio").toString("base64"),
      },
    });
  });

  it.each(["audio/m4a", "audio/x-m4a"])(
    "normaliza %s para audio/mp4 ao enviar ao Gemini",
    async (mimeType) => {
      process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "gemini-key";
      process.env.VOICE_TRANSCRIPTION_MODEL = "gemini-flash-latest";
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
        }),
      });

      await transcribeVoiceAudio(Buffer.from("m4a-audio"), mimeType);

      const [, request] = (global as any).fetch.mock.calls[0];
      const body = JSON.parse(request.body);
      expect(body.contents[0].parts[1].inlineData.mimeType).toBe("audio/mp4");
      expect(logger.info).toHaveBeenCalledWith(
        "Transcrição de voz: resposta do provedor",
        expect.objectContaining({
          provider: "gemini",
          status: 200,
          mimeType: "audio/mp4",
          bytes: Buffer.byteLength("m4a-audio"),
          durationMs: expect.any(Number),
        }),
      );
    },
  );

  it("detecta um contêiner M4A pelo box ftyp mesmo se o MIME vier como audio/mpeg", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    const m4aAudio = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
    ]);
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
      }),
    });

    await transcribeVoiceAudio(m4aAudio, "audio/mpeg");

    const [, request] = (global as any).fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("audio/mp4");
  });

  it("preserva audio/3gpp mesmo quando o contêiner também possui box ftyp", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    const threeGppAudio = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x34,
    ]);
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
      }),
    });

    await transcribeVoiceAudio(threeGppAudio, "audio/3gpp");

    const [, request] = (global as any).fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("audio/3gpp");
  });

  it("combina as partes textuais válidas da resposta Gemini", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GOOGLE_API_KEY = "gemini-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "  quero\u0000 agendar" }, { metadata: true }, { text: "amanhã  " }],
            },
          },
        ],
      }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).resolves.toBe(
      "quero agendar\namanhã",
    );
  });

  it("exige chave quando o provider Gemini é explícito", async () => {
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

  it("normaliza resposta Gemini sem texto como falha do provedor", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: "SAFETY" }] }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).rejects.toBeInstanceOf(
      VoiceTranscriptionProviderError,
    );
  });

  it("repete uma vez uma falha temporária 503 do Gemini", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
        }),
      });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).resolves.toBe(
      "Quero agendar",
    );
    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });

  it("lança VoiceTranscriptionRateLimitError ao receber 429 do Gemini", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).rejects.toBeInstanceOf(
      VoiceTranscriptionRateLimitError,
    );
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("repete uma exceção transitória do Gemini com um novo signal", async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    (global as any).fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
        }),
      });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/wav")).resolves.toBe(
      "Quero agendar",
    );

    expect((global as any).fetch).toHaveBeenCalledTimes(2);
    const firstSignal = (global as any).fetch.mock.calls[0][1].signal;
    const secondSignal = (global as any).fetch.mock.calls[1][1].signal;
    expect(firstSignal).not.toBe(secondSignal);
    expect(logger.warn).toHaveBeenCalledWith(
      "Transcrição de voz: provedor indisponível",
      expect.objectContaining({ attempt: 1, reason: "connection_error" }),
    );
  });

  it("repete um timeout do Gemini e cria um AbortSignal por tentativa", async () => {
    jest.useFakeTimers();
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS = "1000";
    process.env.VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS = "100";
    const signals: AbortSignal[] = [];
    (global as any).fetch = jest.fn((_url: string, request: RequestInit) => {
      const signal = request.signal as AbortSignal;
      signals.push(signal);
      if (signals.length > 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Quero agendar" }] } }],
          }),
        });
      }

      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    });

    const transcription = transcribeVoiceAudio(Buffer.from("audio"), "audio/wav");
    const expectation = expect(transcription).resolves.toBe("Quero agendar");
    await jest.advanceTimersByTimeAsync(350);
    await expectation;

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("limita as duas tentativas Gemini ao orçamento total", async () => {
    jest.useFakeTimers();
    process.env.VOICE_TRANSCRIPTION_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS = "500";
    process.env.VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS = "200";
    const startedAt = Date.now();
    const signals: AbortSignal[] = [];
    (global as any).fetch = jest.fn((_url: string, request: RequestInit) => {
      const signal = request.signal as AbortSignal;
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    });

    const transcription = transcribeVoiceAudio(Buffer.from("audio"), "audio/wav");
    const expectation = expect(transcription).rejects.toBeInstanceOf(
      VoiceTranscriptionProviderError,
    );
    await jest.advanceTimersByTimeAsync(500);
    await expectation;

    expect(Date.now() - startedAt).toBe(500);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
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

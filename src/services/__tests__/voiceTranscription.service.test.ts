import {
  transcribeVoiceAudio,
  VoiceTranscriptionConfigurationError,
  VoiceTranscriptionProviderError,
} from "../voiceTranscription.service";

describe("transcribeVoiceAudio", () => {
  const originalFetch = (global as any).fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    (global as any).fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("exige um endpoint de transcrição configurado", async () => {
    delete process.env.VOICE_TRANSCRIPTION_URL;

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionConfigurationError,
    );
  });

  it("envia o áudio ao provedor e devolve somente o texto transcrito", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    process.env.VOICE_TRANSCRIPTION_API_KEY = "test-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "quero agendar uma limpeza" }),
    });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).resolves.toBe(
      "quero agendar uma limpeza",
    );
    expect((global as any).fetch).toHaveBeenCalledWith(
      "https://voice.example.test/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("normaliza falhas do provedor sem vazar detalhes", async () => {
    process.env.VOICE_TRANSCRIPTION_URL = "https://voice.example.test/transcriptions";
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });

    await expect(transcribeVoiceAudio(Buffer.from("audio"), "audio/webm")).rejects.toBeInstanceOf(
      VoiceTranscriptionProviderError,
    );
  });
});

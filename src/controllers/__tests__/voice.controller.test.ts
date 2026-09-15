jest.mock("../../services/voiceTranscription.service", () => ({
  ALLOWED_AUDIO_MIME_TYPES: new Set(["audio/webm"]),
  transcribeVoiceAudio: jest.fn(),
  VoiceTranscriptionConfigurationError: class VoiceTranscriptionConfigurationError extends Error {},
  VoiceTranscriptionProviderError: class VoiceTranscriptionProviderError extends Error {},
}));

jest.mock("../../services/botConversation.service", () => ({
  processMessage: jest.fn(),
}));

import { processVoiceCommand } from "../voice.controller";
import { transcribeVoiceAudio } from "../../services/voiceTranscription.service";
import { processMessage } from "../../services/botConversation.service";

function createResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("processVoiceCommand", () => {
  afterEach(() => jest.clearAllMocks());

  it("transcreve e encaminha a fala à mesma sessão do chatbot", async () => {
    const audio = Buffer.from("voice bytes");
    (transcribeVoiceAudio as jest.Mock).mockResolvedValue("quero agendar uma limpeza");
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 44,
      message: "Qual data você prefere?",
      state: "COLETANDO_DATA",
      context: { serviceName: "Limpeza" },
    });
    const request: any = {
      user: { id: 7 },
      authSessionId: "session-token",
      body: audio,
      query: {},
      header: jest.fn((name: string) => {
        if (name === "content-type") return "audio/webm; codecs=opus";
        if (name === "x-voice-language") return "pt-BR";
        if (name === "x-voice-session-id") return "44";
        if (name === "x-voice-channel") return "voice-web";
        if (name === "x-voice-timezone") return "America/Sao_Paulo";
        return undefined;
      }),
    };
    const response = createResponse();

    await processVoiceCommand(request, response as any);

    expect(transcribeVoiceAudio).toHaveBeenCalledWith(audio, "audio/webm", "pt");
    expect(processMessage).toHaveBeenCalledWith(
      7,
      "session-token",
      "quero agendar uma limpeza",
      44,
      "voice-web",
      undefined,
      "America/Sao_Paulo",
    );
    expect(response.json).toHaveBeenCalledWith({
      transcript: "quero agendar uma limpeza",
      session_id: 44,
      message: "Qual data você prefere?",
      state: "COLETANDO_DATA",
      context: { serviceName: "Limpeza" },
      clear_history: false,
    });
    expect(request.body).toBeUndefined();
    expect(audio.equals(Buffer.alloc(audio.length))).toBe(true);
  });

  it("reutiliza a resposta quando a mesma chave idempotente é repetida", async () => {
    const createRequest = () => ({
      user: { id: 71 },
      authSessionId: "session-token",
      body: Buffer.from("voice bytes"),
      query: {},
      header: jest.fn((name: string) => {
        if (name === "content-type") return "audio/webm";
        if (name === "idempotency-key") return "voice-command-test-71";
        return undefined;
      }),
    });
    (transcribeVoiceAudio as jest.Mock).mockResolvedValue("quero agendar uma limpeza");
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 71,
      message: "Qual data você prefere?",
      state: "COLETANDO_DATA",
      context: {},
    });

    const firstResponse = createResponse();
    await processVoiceCommand(createRequest() as any, firstResponse as any);
    const replayResponse = createResponse();
    await processVoiceCommand(createRequest() as any, replayResponse as any);

    expect(transcribeVoiceAudio).toHaveBeenCalledTimes(1);
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(replayResponse.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
  });
});

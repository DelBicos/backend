jest.mock("../../services/voiceTranscription.service", () => ({
  ALLOWED_AUDIO_MIME_TYPES: new Set(["audio/webm"]),
  transcribeVoiceAudio: jest.fn(),
  VoiceTranscriptionConfigurationError: class VoiceTranscriptionConfigurationError extends Error {},
  VoiceTranscriptionProviderError: class VoiceTranscriptionProviderError extends Error {},
  VoiceTranscriptionRateLimitError: class VoiceTranscriptionRateLimitError extends Error {},
  VoiceUnclearAudioError: class VoiceUnclearAudioError extends Error {},
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

jest.mock("../../services/botConversation.service", () => ({
  processMessage: jest.fn(),
}));

import type { Response } from "express";
import type { AuthenticatedRequest } from "../../interfaces/authentication.interface";
import { MAX_VOICE_AUDIO_BYTES, processVoiceCommand, transcribeVoice } from "../voice.controller";
import {
  transcribeVoiceAudio,
  VoiceTranscriptionConfigurationError,
  VoiceTranscriptionProviderError,
  VoiceTranscriptionRateLimitError,
  VoiceUnclearAudioError,
} from "../../services/voiceTranscription.service";
import { logError } from "../../utils/logger";
import { mockReq, mockRes } from "./handlerTestUtils";
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
        if (name === "x-voice-selected-time") return "2099-01-05T12:00:00Z";
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
      "2099-01-05T12:00:00Z",
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

type VoiceResponse = ReturnType<typeof mockRes> & { setHeader: jest.Mock };

function voiceRes(): VoiceResponse {
  const res = mockRes() as VoiceResponse;
  res.setHeader = jest.fn();
  return res;
}

function voiceReq(
  headers: Record<string, string> = {},
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest {
  return mockReq({
    user: { id: 9 },
    authSessionId: "sessao-9",
    body: Buffer.from("bytes de audio"),
    headers: { "content-type": "audio/webm", ...headers },
    ...overrides,
  });
}

const asRes = (res: VoiceResponse) => res as unknown as Response;
const transcribeMock = transcribeVoiceAudio as jest.Mock;
const processMessageMock = processMessage as jest.Mock;

describe("transcribeVoice", () => {
  afterEach(() => jest.clearAllMocks());

  it("responde 401 sem usuario autenticado", async () => {
    const res = voiceRes();
    await transcribeVoice(voiceReq({}, { user: undefined }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("responde 415 para formato nao suportado e limpa o buffer", async () => {
    const audio = Buffer.from("abc");
    const req = voiceReq({ "content-type": "text/plain" }, { body: audio });
    const res = voiceRes();
    await transcribeVoice(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(415);
    expect(req.body).toBeUndefined();
    expect(audio.equals(Buffer.alloc(3))).toBe(true);
  });

  it("responde 415 sem content-type e sem corpo binario", async () => {
    const req = mockReq<AuthenticatedRequest>({ user: { id: 1 }, body: { foo: 1 } });
    const res = voiceRes();
    await transcribeVoice(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(415);
    expect(req.body).toEqual({ foo: 1 });
  });

  it("responde 400 quando o corpo nao e um buffer", async () => {
    const res = voiceRes();
    await transcribeVoice(voiceReq({}, { body: "texto" }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("responde 400 quando o buffer esta vazio", async () => {
    const res = voiceRes();
    await transcribeVoice(voiceReq({}, { body: Buffer.alloc(0) }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("responde 413 quando o audio passa do limite", async () => {
    const req = voiceReq({}, { body: Buffer.alloc(MAX_VOICE_AUDIO_BYTES + 1, 1) });
    const res = voiceRes();
    await transcribeVoice(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(413);
    expect(req.body).toBeUndefined();
  });

  it("transcreve usando o idioma informado e libera o audio", async () => {
    transcribeMock.mockResolvedValue("ola");
    const audio = Buffer.from("fala");
    const req = voiceReq({ "x-voice-language": "EN-us" }, { body: audio });
    const res = voiceRes();
    await transcribeVoice(req, asRes(res));
    expect(transcribeMock).toHaveBeenCalledWith(audio, "audio/webm", "en");
    expect(res.json).toHaveBeenCalledWith({ text: "ola", language: "en" });
    expect(req.body).toBeUndefined();
  });

  it("usa portugues quando o idioma informado e invalido", async () => {
    transcribeMock.mockResolvedValue("oi");
    const res = voiceRes();
    await transcribeVoice(voiceReq({ "x-voice-language": "portugues" }), asRes(res));
    expect(res.json).toHaveBeenCalledWith({ text: "oi", language: "pt" });
  });

  it.each([
    [new VoiceUnclearAudioError(), 422],
    [new VoiceTranscriptionConfigurationError(), 503],
    [new VoiceTranscriptionProviderError(), 502],
  ])("mapeia erro conhecido da transcricao (caso %#)", async (error, status) => {
    transcribeMock.mockRejectedValue(error);
    const res = voiceRes();
    await transcribeVoice(voiceReq(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(status);
  });

  it("responde 429 com cabecalhos de espera no limite de taxa", async () => {
    transcribeMock.mockRejectedValue(new VoiceTranscriptionRateLimitError());
    const res = voiceRes();
    await transcribeVoice(voiceReq(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Reset", expect.any(String));
  });

  it("responde 500 e registra erro inesperado", async () => {
    transcribeMock.mockRejectedValue(new Error("boom"));
    const req = voiceReq();
    const res = voiceRes();
    await transcribeVoice(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalled();
    expect(req.body).toBeUndefined();
  });
});

describe("processVoiceCommand - validacoes e erros", () => {
  afterEach(() => jest.clearAllMocks());

  it("responde 401 sem usuario autenticado", async () => {
    const res = voiceRes();
    await processVoiceCommand(voiceReq({}, { user: undefined }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("responde 415 para formato de audio nao suportado", async () => {
    const res = voiceRes();
    await processVoiceCommand(voiceReq({ "content-type": "image/png" }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(415);
  });

  it.each(["abc", "0", "-3", "1.5"])("responde 400 para X-Voice-Session-Id %s", async (value) => {
    const req = voiceReq({ "x-voice-session-id": value });
    const res = voiceRes();
    await processVoiceCommand(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "X-Voice-Session-Id inválido" });
    expect(req.body).toBeUndefined();
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("responde 400 para Idempotency-Key invalida", async () => {
    const req = voiceReq({ "idempotency-key": "curta" });
    const res = voiceRes();
    await processVoiceCommand(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(req.body).toBeUndefined();
  });

  it("usa o canal padrao quando o canal informado so tem caracteres invalidos", async () => {
    transcribeMock.mockResolvedValue("oi");
    processMessageMock.mockResolvedValue({
      sessionId: 3,
      message: "Ola",
      state: "INICIO",
      context: {},
      clearHistory: true,
    });
    const res = voiceRes();
    await processVoiceCommand(voiceReq({ "x-voice-channel": "!!!" }), asRes(res));
    expect(processMessageMock).toHaveBeenCalledWith(
      9,
      "sessao-9",
      "oi",
      undefined,
      "voice",
      undefined,
      undefined,
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).not.toHaveBeenCalledWith("Idempotency-Replayed", "true");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ clear_history: true }));
  });

  it("mapeia erro conhecido da transcricao", async () => {
    transcribeMock.mockRejectedValue(new VoiceUnclearAudioError());
    const res = voiceRes();
    await processVoiceCommand(voiceReq(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(422);
    expect(processMessageMock).not.toHaveBeenCalled();
  });

  it("responde 404 quando a sessao do chatbot nao existe", async () => {
    transcribeMock.mockResolvedValue("oi");
    processMessageMock.mockRejectedValue(new Error("Sessão não encontrada"));
    const res = voiceRes();
    await processVoiceCommand(voiceReq({ "x-voice-session-id": "12" }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Sessão não encontrada" });
  });

  it("responde 500 para erro inesperado do chatbot", async () => {
    transcribeMock.mockResolvedValue("oi");
    processMessageMock.mockRejectedValue(new Error("falha"));
    const req = voiceReq();
    const res = voiceRes();
    await processVoiceCommand(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalled();
    expect(req.body).toBeUndefined();
  });
});

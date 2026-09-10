import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import logger, { logError } from "../utils/logger";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  transcribeVoiceAudio,
  VoiceTranscriptionConfigurationError,
  VoiceTranscriptionProviderError,
  VoiceTranscriptionRateLimitError,
} from "../services/voiceTranscription.service";
import { processMessage } from "../services/botConversation.service";
import { BotSessionContext } from "../models/BotChatSession";
import {
  getVoiceCommandIdempotencyKey,
  voiceCommandIdempotencyStore,
} from "../services/voiceCommandIdempotency.service";

export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;

function requestMimeType(req: AuthenticatedRequest): string {
  const contentType = req.header("content-type") ?? "";
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

interface VoiceAudioInput {
  rawAudio: Buffer;
  mimeType: string;
  language: string;
}

interface VoiceCommandMetadata {
  sessionId?: number;
  channel: string;
  selectedTime?: string;
  timeZone?: string;
}

interface VoiceCommandResponse {
  transcript: string;
  session_id: number;
  message: string;
  state: string;
  context: BotSessionContext;
  clear_history: boolean;
}

function optionalHeader(req: AuthenticatedRequest, name: string, maxLength = 100): string | undefined {
  const value = req.header(name)?.trim();
  return value ? value.slice(0, maxLength) : undefined;
}

function getVoiceCommandMetadata(
  req: AuthenticatedRequest,
  res: Response,
): VoiceCommandMetadata | null {
  const rawSessionId = optionalHeader(req, "x-voice-session-id", 20);
  const sessionId = rawSessionId ? Number(rawSessionId) : undefined;
  if (rawSessionId && (!Number.isInteger(sessionId) || sessionId! <= 0)) {
    res.status(400).json({ error: "X-Voice-Session-Id inválido" });
    return null;
  }

  const requestedChannel = optionalHeader(req, "x-voice-channel", 50);
  const channel = requestedChannel
    ? requestedChannel.replace(/[^a-z0-9_-]/gi, "").slice(0, 50)
    : "voice";

  return {
    sessionId,
    channel: channel || "voice",
    selectedTime: optionalHeader(req, "x-voice-selected-time"),
    timeZone: optionalHeader(req, "x-voice-timezone"),
  };
}

function getVoiceAudioInput(
  req: AuthenticatedRequest,
  res: Response,
): VoiceAudioInput | null {
  const mimeType = requestMimeType(req);
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    if (Buffer.isBuffer(req.body)) releaseAudio(req, req.body);
    res.status(415).json({ error: "Formato de áudio não suportado" });
    return null;
  }

  const rawAudio = req.body;
  if (!Buffer.isBuffer(rawAudio) || rawAudio.length === 0) {
    res.status(400).json({ error: "Envie um arquivo de áudio no corpo da requisição" });
    return null;
  }
  if (rawAudio.length > MAX_VOICE_AUDIO_BYTES) {
    releaseAudio(req, rawAudio);
    res.status(413).json({ error: "Áudio excede o limite de 10 MB" });
    return null;
  }

  const languageHeader = req.header("x-voice-language")?.trim().toLowerCase();
  const language = languageHeader && /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(languageHeader)
    ? languageHeader.split("-", 1)[0]
    : "pt";
  return { rawAudio, mimeType, language };
}

function releaseAudio(req: AuthenticatedRequest, rawAudio: Buffer): void {
  // O buffer vive apenas durante esta requisição. Limpa a referência antes da
  // resposta ser finalizada para não reter áudio em memória do servidor.
  rawAudio.fill(0);
  req.body = undefined;
}

function transcriptionErrorResponse(
  error: unknown,
  res: Response,
): Response | null {
  if (error instanceof VoiceTranscriptionConfigurationError) {
    return res.status(503).json({
      error: "Transcrição de voz ainda não está configurada neste ambiente",
    });
  }
  if (error instanceof VoiceTranscriptionRateLimitError) {
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 60;
    res.setHeader("Retry-After", "60");
    res.setHeader("RateLimit-Reset", String(resetEpochSeconds));
    return res.status(429).json({
      error: "Limite de requisições de transcrição excedido. Aguarde alguns instantes e tente novamente.",
    });
  }
  if (error instanceof VoiceTranscriptionProviderError) {
    return res.status(502).json({
      error: "Não foi possível transcrever o áudio. Tente falar novamente.",
    });
  }
  return null;
}

/**
 * POST /api/voice/transcriptions
 *
 * Recebe o corpo bruto de um único áudio. O front web e o mobile usam o mesmo
 * contrato, enviando Content-Type áudio/* e X-Voice-Language: pt.
 */
export const transcribeVoice = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  const audioInput = getVoiceAudioInput(req, res);
  if (!audioInput) return res;

  try {
    const text = await transcribeVoiceAudio(
      audioInput.rawAudio,
      audioInput.mimeType,
      audioInput.language,
    );
    // Não registrar transcrição ou bytes de áudio: podem conter dados pessoais.
    logger.info("Voz: áudio transcrito", { userId: req.user.id, mimeType: audioInput.mimeType });
    return res.json({ text, language: audioInput.language });
  } catch (error) {
    const expectedResponse = transcriptionErrorResponse(error, res);
    if (expectedResponse) return expectedResponse;
    logError("Voz: erro inesperado na transcrição", error, { userId: req.user.id });
    return res.status(500).json({ error: "Erro interno ao transcrever o áudio" });
  } finally {
    releaseAudio(req, audioInput.rawAudio);
  }
};

/**
 * POST /api/voice/commands
 *
 * Transcreve a fala e a entrega à mesma máquina de estados usada por
 * POST /api/chat/bot/message. O front não precisa fazer duas chamadas nem
 * interpretar comandos localmente.
 */
export const processVoiceCommand = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  const audioInput = getVoiceAudioInput(req, res);
  if (!audioInput) return res;

  const metadata = getVoiceCommandMetadata(req, res);
  if (!metadata) {
    releaseAudio(req, audioInput.rawAudio);
    return res;
  }

  const idempotencyKey = getVoiceCommandIdempotencyKey(req.header("idempotency-key"));
  if (idempotencyKey === null) {
    releaseAudio(req, audioInput.rawAudio);
    return res.status(400).json({
      error: "Idempotency-Key inválido; use de 8 a 128 caracteres seguros",
    });
  }

  try {
    const executeCommand = async (): Promise<VoiceCommandResponse> => {
      const transcript = await transcribeVoiceAudio(
        audioInput.rawAudio,
        audioInput.mimeType,
        audioInput.language,
      );
      const result = await processMessage(
        req.user!.id,
        req.authSessionId,
        transcript,
        metadata.sessionId,
        metadata.channel,
        metadata.selectedTime,
        metadata.timeZone,
      );

      logger.info("Voz: comando processado pelo chatbot", {
        userId: req.user!.id,
        sessionId: result.sessionId,
        state: result.state,
        mimeType: audioInput.mimeType,
      });
      return {
        transcript,
        session_id: result.sessionId,
        message: result.message,
        state: result.state,
        context: result.context,
        clear_history: result.clearHistory === true,
      };
    };

    const execution = idempotencyKey
      ? await voiceCommandIdempotencyStore.execute(req.user.id, idempotencyKey, executeCommand)
      : { result: await executeCommand(), replayed: false };

    res.setHeader("Cache-Control", "no-store");
    if (execution.replayed) {
      res.setHeader("Idempotency-Replayed", "true");
      logger.info("Voz: resposta idempotente reutilizada", { userId: req.user.id });
    }
    return res.json(execution.result);
  } catch (error: any) {
    const expectedResponse = transcriptionErrorResponse(error, res);
    if (expectedResponse) return expectedResponse;

    logError("Voz: erro ao processar comando no chatbot", error, {
      userId: req.user.id,
      sessionId: metadata.sessionId,
    });
    if (error?.message?.includes("Sessão não encontrada")) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno ao processar comando de voz" });
  } finally {
    releaseAudio(req, audioInput.rawAudio);
  }
};

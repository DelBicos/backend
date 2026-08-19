import express, { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import authMiddleware from "../middlewares/auth.middleware";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import {
  MAX_VOICE_AUDIO_BYTES,
  processVoiceCommand,
  transcribeVoice,
} from "../controllers/voice.controller";
import { ALLOWED_AUDIO_MIME_TYPES } from "../services/voiceTranscription.service";

const voiceRouter = Router();
const isProduction = (process.env.ENVIRONMENT || process.env.NODE_ENV) === "production";

const voiceTranscriptionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 30 : 120,
  // A rota é autenticada. Usar a conta evita que usuários no mesmo Wi-Fi
  // bloqueiem uns aos outros e preserva fallback seguro caso a autenticação
  // seja reorganizada no futuro.
  keyGenerator: (req) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições de voz. Aguarde alguns minutos antes de tentar novamente." },
});

function getMimeType(contentType: string | undefined): string {
  return contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

// Não tenta converter corpos que não são áudio. O controller ainda responde
// 415 para manter uma mensagem de erro consistente para o aplicativo.
const voiceAudioParser = express.raw({
  type: (req) => getMimeType(req.headers["content-type"]) !== "" &&
    ALLOWED_AUDIO_MIME_TYPES.has(getMimeType(req.headers["content-type"])),
  limit: MAX_VOICE_AUDIO_BYTES,
});

/**
 * O contrato usa o corpo bruto (audio/webm, audio/mp4, etc.), o que elimina
 * diferenças entre FormData de navegadores e bibliotecas de React Native.
 */
voiceRouter.post(
  "/transcriptions",
  authMiddleware,
  voiceTranscriptionRateLimit,
  voiceAudioParser,
  transcribeVoice as any,
);

voiceRouter.post(
  "/commands",
  authMiddleware,
  voiceTranscriptionRateLimit,
  voiceAudioParser,
  processVoiceCommand as any,
);

voiceRouter.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    return res.status(413).json({ error: "Áudio excede o limite de 10 MB" });
  }
  return next(error);
});

export default voiceRouter;

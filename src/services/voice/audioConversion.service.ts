import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

/**
 * O endpoint de audio curto do Azure Speech so decodifica WAV (PCM) e OGG/Opus.
 * Os navegadores gravam em WebM (Chrome, Edge, Firefox) ou MP4/AAC (Safari) e o
 * app nativo grava em M4A; esses formatos precisam ser convertidos antes.
 */
// Mesmo WAV e convertido: chega do cliente com taxa variavel e o Azure espera 16 kHz.
const AZURE_NATIVE_TYPES = new Set(["audio/ogg"]);

const DEFAULT_CONVERSION_TIMEOUT_MS = 15_000;

export function needsConversionForAzure(mimeType: string): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return !AZURE_NATIVE_TYPES.has(base);
}

/**
 * Converte qualquer audio suportado pelo ffmpeg em WAV PCM 16 kHz mono, o formato
 * recomendado pelo Azure Speech. Usa arquivos temporarios porque MP4/M4A guardam
 * o indice no fim do arquivo e nao podem ser lidos pela entrada padrao.
 */
export async function convertToWav16kMono(
  audio: Buffer,
  timeoutMs = DEFAULT_CONVERSION_TIMEOUT_MS,
): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("Binario do ffmpeg indisponivel nesta plataforma");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-"));
  const input = path.join(dir, "input");
  const output = path.join(dir, "output.wav");
  try {
    await fs.writeFile(input, audio);
    await runFfmpeg(
      ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-f", "wav", "-y", output],
      timeoutMs,
    );
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(binary: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Tempo esgotado na conversao do audio"));
    }, timeoutMs);
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg terminou com codigo ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

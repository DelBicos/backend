import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { convertToWav16kMono, needsConversionForAzure } from "../audioConversion.service";

describe("needsConversionForAzure", () => {
  it.each(["audio/webm", "audio/webm;codecs=opus", "audio/mp4", "audio/m4a", "audio/wav", "audio/mpeg"])(
    "converte %s",
    (mimeType) => expect(needsConversionForAzure(mimeType)).toBe(true),
  );

  it("mantém OGG/Opus, que o Azure decodifica direto", () => {
    expect(needsConversionForAzure("audio/ogg;codecs=opus")).toBe(false);
  });
});

describe("convertToWav16kMono", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
  const tone = (file: string, codec: string) => {
    const out = path.join(dir, file);
    execFileSync(ffmpegPath as string, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-ac", "2", "-ar", "48000", "-c:a", codec, "-y", out,
    ]);
    return readFileSync(out);
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ["gravação do Chrome (WebM/Opus)", "t.webm", "libopus"],
    ["gravação do Safari e do app (MP4/AAC)", "t.m4a", "aac"],
  ])("converte %s em WAV PCM 16 kHz mono", async (_label, file, codec) => {
    const wav = await convertToWav16kMono(tone(file, codec));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // canais
    expect(wav.readUInt32LE(24)).toBe(16000); // taxa de amostragem
    expect(wav.readUInt16LE(34)).toBe(16); // bits por amostra
  }, 20000);

  it("falha com áudio inválido", async () => {
    await expect(convertToWav16kMono(Buffer.from("isto nao e audio"))).rejects.toThrow();
  });
});

// O pacote ffmpeg-static nao publica tipos: exporta o caminho do binario do ffmpeg.
declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

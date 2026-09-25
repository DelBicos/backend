/**
 * Politica de upload: apenas imagens, com chave gerada no servidor.
 * O nome enviado pelo cliente nunca vira a chave do objeto (evita
 * sobrescrever arquivos de outros usuarios e path traversal).
 */
import { randomUUID } from "crypto";
import { HttpError } from "../../errors/HttpError";

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function assertAllowedImageType(fileType: unknown): string {
  const type = String(fileType ?? "").trim().toLowerCase();
  const ext = ALLOWED_IMAGE_TYPES[type];
  if (!ext) {
    throw HttpError.badRequest(
      "Tipo de arquivo não permitido. Envie uma imagem JPEG, PNG ou WEBP.",
    );
  }
  return ext;
}

/** Ex.: avatars/12/3f1c...e2.jpg */
export function buildObjectKey(folder: string, userId: number, fileType: unknown): string {
  const ext = assertAllowedImageType(fileType);
  return `${folder}/${userId}/${randomUUID()}.${ext}`;
}

/** URLs de imagem aceitas para salvar no perfil. */
export function assertHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string") throw HttpError.badRequest(`${field} inválido`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw HttpError.badRequest(`${field} inválido`);
  }
  if (url.protocol !== "https:") {
    throw HttpError.badRequest(`${field} deve usar https`);
  }
  return url.toString();
}

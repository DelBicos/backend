import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { getStorageAdapter } from "../services/storage/StorageFactory";
import { buildObjectKey } from "../services/storage/uploadPolicy";
import { HttpError } from "../errors/HttpError";

import { logError } from "../utils/logger";
/**
 * POST /api/uploads
 * Body: { fileName: string, fileType: string }
 * Retorna uma URL temporária de upload direto (Azure Blob) e a URL pública do arquivo.
 *
 * O frontend deve:
 * 1. Chamar este endpoint para obter uploadUrl, fileUrl e uploadHeaders
 * 2. Fazer PUT na uploadUrl com o arquivo binário e os uploadHeaders
 * 3. Salvar fileUrl como banner_uri no serviço
 */
export const getUploadUrl = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const body = req.body as {
      fileName?: string;
      fileType?: string;
      filename?: string; // alias enviado pelo frontend
      contentType?: string; // alias enviado pelo frontend
    };

    // Aceita ambos os nomes de campo (frontend e backend)
    const fileName = (body.fileName || body.filename || "").trim();
    const fileType = (body.fileType || body.contentType || "").trim();

    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!fileName)
      return res.status(400).json({ error: "fileName é obrigatório" });

    // Chave gerada no servidor; valida que o arquivo e uma imagem.
    const key = buildObjectKey("uploads", req.user.id, fileType);

    const { uploadUrl, fileUrl, uploadHeaders } =
      await getStorageAdapter().generateUploadUrl(key, fileType);

    // Retorna ambos os nomes de campo para compatibilidade com frontend e backend
    return res.json({
      uploadUrl,
      url: fileUrl,
      presignedUrl: uploadUrl, // alias esperado pelo frontend
      fileUrl, // alias esperado pelo frontend
      uploadHeaders: uploadHeaders ?? {},
    });
  } catch (error) {
    if (error instanceof HttpError)
      return res.status(error.status).json({ error: error.message });
    logError("Erro getUploadUrl:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

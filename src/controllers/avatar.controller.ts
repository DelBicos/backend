import { Request, Response } from "express";
import { UserModel } from "../models/User";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { getStorageAdapter } from "../services/storage/StorageFactory";
import { assertHttpsUrl, buildObjectKey } from "../services/storage/uploadPolicy";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

export const AvatarController = {
  /** Lista todos os arquivos do bucket: restrito a administradores na rota. */
  listFiles: asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getStorageAdapter().listFiles());
  }),

  getFileUrl: asyncHandler(async (req: Request, res: Response) => {
    res.json({ url: await getStorageAdapter().getFileUrl(req.params.key) });
  }),

  /** URL de upload do avatar; a chave e gerada no servidor (avatars/<userId>/<uuid>). */
  getPresignedUrl: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const key = buildObjectKey("avatars", requireUserId(req), req.body?.fileType);
    const { uploadUrl, fileUrl } = await getStorageAdapter().generateUploadUrl(
      key,
      String(req.body.fileType).toLowerCase(),
    );
    res.json({ uploadUrl, fileUrl });
  }),

  getUserAvatar: asyncHandler(async (req: Request, res: Response) => {
    const user = await UserModel.findByPk(req.params.id, {
      attributes: ["id", "avatar_uri"],
    });
    if (!user) throw HttpError.notFound("Usuário não encontrado");
    res.json({ avatar_uri: user.avatar_uri });
  }),

  /** Salva a URL do avatar do proprio usuario autenticado. */
  updateAvatarDatabase: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const avatarUri = assertHttpsUrl(req.body?.avatar_uri, "avatar_uri");
    const user = await UserModel.findByPk(requireUserId(req));
    if (!user) throw HttpError.notFound("Usuário não encontrado no banco.");

    await user.update({ avatar_uri: avatarUri });
    res.json({ mensagem: "Perfil atualizado no banco!", avatar_uri: avatarUri });
  }),
};

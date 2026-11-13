jest.mock("../../services/storage/StorageFactory", () => ({
  getStorageAdapter: jest.fn(),
}));
jest.mock("../../models/User", () => ({
  UserModel: { findByPk: jest.fn() },
}));

import { getStorageAdapter } from "../../services/storage/StorageFactory";
import { UserModel } from "../../models/User";
import { AvatarController } from "../avatar.controller";
import { mockReq, mockRes } from "../../test/http";

const storage = {
  listFiles: jest.fn(),
  getFileUrl: jest.fn(),
  generateUploadUrl: jest.fn(),
};

describe("AvatarController", () => {
  beforeEach(() => {
    (getStorageAdapter as jest.Mock).mockReturnValue(storage);
  });

  it("lists files from storage", async () => {
    storage.listFiles.mockResolvedValue([{ name: "a.png" }]);
    const res = mockRes();
    await AvatarController.listFiles(mockReq() as any, res);
    expect(res.json).toHaveBeenCalledWith([{ name: "a.png" }]);
  });

  it("returns 500 when listing fails", async () => {
    storage.listFiles.mockRejectedValue(new Error("s3 down"));
    const res = mockRes();
    await AvatarController.listFiles(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "s3 down" });
  });

  it("returns 404 when the user has no avatar row", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await AvatarController.getUserAvatar(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não encontrado" });
  });

  it("returns 401 when the token has no user id", async () => {
    const res = mockRes();
    await AvatarController.updateAvatarDatabase(
      mockReq({ body: { avatar_uri: "https://cdn/a.png" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("updates the avatar uri for the authenticated user", async () => {
    const update = jest.fn();
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 3, update });
    const res = mockRes();
    await AvatarController.updateAvatarDatabase(
      mockReq({
        user: { id: 3 },
        body: { avatar_uri: "https://cdn/a.png" },
      }) as any,
      res,
    );
    expect(update).toHaveBeenCalledWith({ avatar_uri: "https://cdn/a.png" });
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Perfil atualizado no banco!",
      avatar_uri: "https://cdn/a.png",
    });
  });

  it("returns a presigned upload url", async () => {
    storage.generateUploadUrl.mockResolvedValue({
      uploadUrl: "https://upload",
      fileUrl: "https://file",
    });
    const res = mockRes();
    await AvatarController.getPresignedUrl(
      mockReq({ body: { fileName: "a.png", fileType: "image/png" } }) as any,
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      uploadUrl: "https://upload",
      fileUrl: "https://file",
    });
  });
});

jest.mock("../../config/database");
jest.mock("../../services/storage/StorageFactory", () => ({
  getStorageAdapter: jest.fn(),
}));
jest.mock("../../models/User", () => ({
  UserModel: { findByPk: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { getStorageAdapter } from "../../services/storage/StorageFactory";
import { UserModel } from "../../models/User";
import { AvatarController } from "../avatar.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const storage = { listFiles: jest.fn(), getFileUrl: jest.fn() };
const findByPk = UserModel.findByPk as jest.Mock;

const listFiles = settled(AvatarController.listFiles);
const getFileUrl = settled(AvatarController.getFileUrl);
const getUserAvatar = settled(AvatarController.getUserAvatar);
const updateAvatarDatabase = settled(AvatarController.updateAvatarDatabase);

beforeEach(() => {
  jest.clearAllMocks();
  (getStorageAdapter as jest.Mock).mockReturnValue(storage);
});

describe("AvatarController", () => {
  it("lista os arquivos do armazenamento", async () => {
    storage.listFiles.mockResolvedValue([{ name: "a.png" }]);
    const res = mockRes();
    await listFiles(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ name: "a.png" }]);
  });

  it("falha ao listar vira 500 generico, sem vazar a mensagem interna", async () => {
    storage.listFiles.mockRejectedValue(new Error("storage fora"));
    const res = mockRes();
    await listFiles(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Erro interno do servidor",
    });
  });

  it("devolve a URL de leitura de um arquivo", async () => {
    storage.getFileUrl.mockResolvedValue("https://conta/c/a.png?sig=1");
    const res = mockRes();
    await getFileUrl(mockReq({ params: { key: "avatars/1/a.png" } }), res);
    expect(storage.getFileUrl).toHaveBeenCalledWith("avatars/1/a.png");
    expect(res.json).toHaveBeenCalledWith({
      url: "https://conta/c/a.png?sig=1",
    });
  });

  it("devolve o avatar do usuario e 404 quando ele nao existe", async () => {
    findByPk.mockResolvedValueOnce({ id: 1, avatar_uri: "https://cdn/a.png" });
    const res = mockRes();
    await getUserAvatar(mockReq({ params: { id: "1" } }), res);
    expect(res.json).toHaveBeenCalledWith({ avatar_uri: "https://cdn/a.png" });

    findByPk.mockResolvedValueOnce(null);
    const missing = mockRes();
    await getUserAvatar(mockReq({ params: { id: "2" } }), missing);
    expect(missing.status).toHaveBeenCalledWith(404);
    expect(missing.json).toHaveBeenCalledWith({
      error: "Usuário não encontrado",
    });
  });

  describe("updateAvatarDatabase", () => {
    it("exige usuario autenticado (401)", async () => {
      const res = mockRes();
      await updateAvatarDatabase(
        mockReq({ body: { avatar_uri: "https://cdn/a.png" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(findByPk).not.toHaveBeenCalled();
    });

    it("recusa URL que nao e https (400)", async () => {
      const res = mockRes();
      await updateAvatarDatabase(
        mockReq({ user: { id: 3 }, body: { avatar_uri: "http://cdn/a.png" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(findByPk).not.toHaveBeenCalled();
    });

    it("responde 404 quando o usuario nao existe mais", async () => {
      findByPk.mockResolvedValue(null);
      const res = mockRes();
      await updateAvatarDatabase(
        mockReq({ user: { id: 3 }, body: { avatar_uri: "https://cdn/a.png" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("salva o avatar do proprio usuario autenticado", async () => {
      const update = jest.fn();
      findByPk.mockResolvedValue({ id: 3, update });
      const res = mockRes();
      await updateAvatarDatabase(
        mockReq({ user: { id: 3 }, body: { avatar_uri: "https://cdn/a.png" } }),
        res,
      );
      expect(findByPk).toHaveBeenCalledWith(3);
      expect(update).toHaveBeenCalledWith({ avatar_uri: "https://cdn/a.png" });
      expect(res.json).toHaveBeenCalledWith({
        mensagem: "Perfil atualizado no banco!",
        avatar_uri: "https://cdn/a.png",
      });
    });
  });
});

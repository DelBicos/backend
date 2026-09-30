jest.mock("../../config/database");
jest.mock("../../models/User");
jest.mock("../../services/storage/StorageFactory", () => ({
  getStorageAdapter: jest.fn(),
}));

import { getStorageAdapter } from "../../services/storage/StorageFactory";
import { getUploadUrl } from "../upload.controller";
import { AvatarController } from "../avatar.controller";

const mockGenerate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (getStorageAdapter as jest.Mock).mockReturnValue({ generateUploadUrl: mockGenerate });
});

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("getUploadUrl", () => {
  it("devolve URL de upload, URL final e os cabecalhos do provedor", async () => {
    mockGenerate.mockResolvedValue({
      uploadUrl: "https://conta.blob.core.windows.net/c/uploads/7/k.png?sig=1",
      fileUrl: "https://conta.blob.core.windows.net/c/uploads/7/k.png",
      uploadHeaders: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/png" },
    });
    const res = makeRes();
    await getUploadUrl(
      { user: { id: 7 }, body: { filename: "banner.png", contentType: "image/png" } } as any,
      res,
    );

    const key = mockGenerate.mock.calls[0][0];
    expect(key).toMatch(/^uploads\/7\/[0-9a-f-]{36}\.png$/);
    const body = res.json.mock.calls[0][0];
    expect(body.uploadUrl).toContain("sig=1");
    expect(body.presignedUrl).toBe(body.uploadUrl);
    expect(body.fileUrl).toBe("https://conta.blob.core.windows.net/c/uploads/7/k.png");
    expect(body.uploadHeaders).toEqual({ "x-ms-blob-type": "BlockBlob", "Content-Type": "image/png" });
  });

  it("proxy (ImgBB): cabecalhos vazios e fileUrl nula", async () => {
    mockGenerate.mockResolvedValue({ uploadUrl: "/api/proxy-upload/tok", fileUrl: null });
    const res = makeRes();
    await getUploadUrl(
      { user: { id: 7 }, body: { fileName: "a.png", fileType: "image/png" } } as any,
      res,
    );
    const body = res.json.mock.calls[0][0];
    expect(body.uploadHeaders).toEqual({});
    expect(body.fileUrl).toBeNull();
  });

  it("recusa tipo de arquivo que nao e imagem (400) e usuario anonimo (401)", async () => {
    const res = makeRes();
    await getUploadUrl({ user: { id: 7 }, body: { fileName: "a.exe", fileType: "application/x-msdownload" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const anon = makeRes();
    await getUploadUrl({ body: { fileName: "a.png", fileType: "image/png" } } as any, anon);
    expect(anon.status).toHaveBeenCalledWith(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("AvatarController.getPresignedUrl", () => {
  it("inclui os cabecalhos de upload e gera a chave no servidor", async () => {
    mockGenerate.mockResolvedValue({
      uploadUrl: "https://x/y?sig=1",
      fileUrl: "https://x/y",
      uploadHeaders: { "x-ms-blob-type": "BlockBlob" },
    });
    const res = makeRes();
    const next = jest.fn();
    await (AvatarController.getPresignedUrl as any)(
      { user: { id: 3 }, body: { fileType: "image/jpeg" } },
      res,
      next,
    );
    await new Promise((r) => setImmediate(r));
    expect(mockGenerate.mock.calls[0][0]).toMatch(/^avatars\/3\/[0-9a-f-]{36}\.jpg$/);
    expect(res.json).toHaveBeenCalledWith({
      uploadUrl: "https://x/y?sig=1",
      fileUrl: "https://x/y",
      uploadHeaders: { "x-ms-blob-type": "BlockBlob" },
    });
  });
});

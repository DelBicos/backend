jest.mock("../../services/storage/StorageFactory", () => ({
  getStorageAdapter: jest.fn(),
}));

import { getStorageAdapter } from "../../services/storage/StorageFactory";
import { getUploadUrl } from "../upload.controller";
import { mockReq, mockRes } from "../../test/http";

describe("getUploadUrl", () => {
  const generateUploadUrl = jest.fn();

  beforeEach(() => {
    (getStorageAdapter as jest.Mock).mockReturnValue({ generateUploadUrl });
  });

  it("returns 400 when fileName is missing", async () => {
    const res = mockRes();
    await getUploadUrl(mockReq({ body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "fileName é obrigatório" });
  });

  it("returns 400 when fileType is missing", async () => {
    const res = mockRes();
    await getUploadUrl(mockReq({ body: { fileName: "a.jpg" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "fileType é obrigatório" });
  });

  it("returns the signed upload url and the public file url", async () => {
    generateUploadUrl.mockResolvedValue({
      uploadUrl: "https://signed",
      fileUrl: "https://public/a.jpg",
    });
    const res = mockRes();
    await getUploadUrl(
      mockReq({ body: { fileName: "a.jpg", fileType: "image/jpeg" } }) as any,
      res,
    );
    const body = res.json.mock.calls[0][0];
    expect(body.uploadUrl).toBe("https://signed");
    expect(body.fileUrl).toBe("https://public/a.jpg");
    expect(body.presignedUrl).toBe("https://signed");
  });

  it("returns 500 when storage fails", async () => {
    generateUploadUrl.mockRejectedValue(new Error("s3"));
    const res = mockRes();
    await getUploadUrl(
      mockReq({ body: { fileName: "a.jpg", fileType: "image/jpeg" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno do servidor" });
  });
});

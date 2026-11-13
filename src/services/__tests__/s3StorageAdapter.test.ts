const generateUploadUrl = jest.fn();
const getFileUrl = jest.fn();
const listFiles = jest.fn();

jest.mock("../s3Service", () => ({
  S3Service: jest.fn().mockImplementation(() => ({
    generateUploadUrl,
    getFileUrl,
    listFiles,
  })),
}));

import { S3StorageAdapter } from "../storage/S3StorageAdapter";

describe("S3StorageAdapter", () => {
  const adapter = new S3StorageAdapter();

  it("asks S3 for a signed upload url and builds the public file url", async () => {
    generateUploadUrl.mockResolvedValue("https://s3.example/signed-put");

    await expect(
      adapter.generateUploadUrl("uploads/a.jpg", "image/jpeg"),
    ).resolves.toEqual({
      uploadUrl: "https://s3.example/signed-put",
      fileUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/a.jpg`,
    });
    expect(generateUploadUrl).toHaveBeenCalledWith("uploads/a.jpg", "image/jpeg");
  });

  it("returns the signed read url from the SDK", async () => {
    getFileUrl.mockResolvedValue("https://s3.example/signed-get");
    await expect(adapter.getFileUrl("uploads/a.jpg")).resolves.toBe(
      "https://s3.example/signed-get",
    );
  });

  it("lists files through the SDK", async () => {
    const files = [{ name: "a.jpg", size: 10, lastModified: new Date(0) }];
    listFiles.mockResolvedValue(files);
    await expect(adapter.listFiles()).resolves.toBe(files);
  });
});

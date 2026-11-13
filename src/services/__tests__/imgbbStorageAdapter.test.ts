import { pendingUploads, ImgBBStorageAdapter } from "../storage/ImgBBStorageAdapter";

describe("ImgBBStorageAdapter", () => {
  const adapter = new ImgBBStorageAdapter();

  afterEach(() => {
    pendingUploads.clear();
  });

  it("builds a relative upload url and keeps fileUrl unknown", async () => {
    const result = await adapter.generateUploadUrl("avatar.jpg", "image/jpeg");

    expect(result.fileUrl).toBeNull();
    expect(result.uploadUrl).toMatch(/^\/api\/proxy-upload\//);
    const token = result.uploadUrl.split("/").pop() as string;
    expect(pendingUploads.get(token)?.fileType).toBe("image/jpeg");
  });

  it("returns the stored public url as the file url", async () => {
    await expect(adapter.getFileUrl("https://i.ibb.co/abc.jpg")).resolves.toBe(
      "https://i.ibb.co/abc.jpg",
    );
  });

  it("lists nothing because ImgBB has no listing API", async () => {
    await expect(adapter.listFiles()).resolves.toEqual([]);
  });
});

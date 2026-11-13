import { pendingUploads } from "../../services/storage/ImgBBStorageAdapter";
import { proxyUpload } from "../proxyUpload.controller";
import { mockRes } from "../../test/http";

function requestWithBody(token: string, buffer: Buffer) {
  let dataHandler: ((chunk: Buffer) => void) | undefined;
  const req = {
    params: { token },
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") dataHandler = cb as (chunk: Buffer) => void;
      if (event === "end") {
        process.nextTick(() => {
          if (buffer.length && dataHandler) dataHandler(buffer);
          cb();
        });
      }
      return req;
    },
  };
  return req;
}

describe("proxyUpload", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    pendingUploads.clear();
    global.fetch = originalFetch;
    delete process.env.IMGBB_API_KEY;
  });

  it("returns 404 for an unknown token", async () => {
    const res = mockRes();
    await proxyUpload(requestWithBody("missing", Buffer.from("x")) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token de upload inválido ou expirado",
    });
  });

  it("returns 410 for an expired token", async () => {
    pendingUploads.set("old", { fileType: "image/jpeg", expiresAt: Date.now() - 1000 });
    const res = mockRes();
    await proxyUpload(requestWithBody("old", Buffer.from("x")) as any, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({ error: "Token de upload expirado" });
  });

  it("returns 400 when the body is empty", async () => {
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.alloc(0)) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Corpo da requisição vazio" });
  });

  it("returns 500 when IMGBB_API_KEY is missing", async () => {
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "IMGBB_API_KEY não configurada" });
  });

  it("returns 502 when ImgBB rejects the upload", async () => {
    process.env.IMGBB_API_KEY = "key";
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false, error: { message: "bad image" } }),
    }) as any;
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")) as any, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "bad image" });
  });

  it("returns the public file url", async () => {
    process.env.IMGBB_API_KEY = "key";
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { url: "https://i.ibb.co/a.jpg" } }),
    }) as any;
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")) as any, res);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.imgbb.com/1/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.json).toHaveBeenCalledWith({ fileUrl: "https://i.ibb.co/a.jpg" });
  });
});

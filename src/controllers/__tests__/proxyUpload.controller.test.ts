import { pendingUploads } from "../../services/storage/ImgBBStorageAdapter";
import type { Request } from "express";
import { proxyUpload } from "../proxyUpload.controller";
import { mockRes } from "./handlerTestUtils";

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
  return req as unknown as Request;
}

describe("proxyUpload", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    pendingUploads.clear();
    global.fetch = originalFetch;
    delete process.env.IMGBB_API_KEY;
  });

  it("responde 404 para token desconhecido", async () => {
    const res = mockRes();
    await proxyUpload(requestWithBody("missing", Buffer.from("x")), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token de upload inválido ou expirado",
    });
  });

  it("responde 410 para token expirado", async () => {
    pendingUploads.set("old", {
      fileType: "image/jpeg",
      expiresAt: Date.now() - 1000,
    });
    const res = mockRes();
    await proxyUpload(requestWithBody("old", Buffer.from("x")), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token de upload expirado",
    });
  });

  it("responde 400 com corpo vazio", async () => {
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.alloc(0)), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Corpo da requisição vazio",
    });
  });

  it("responde 500 sem IMGBB_API_KEY", async () => {
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "IMGBB_API_KEY não configurada",
    });
  });

  it("responde 502 quando o ImgBB recusa o envio", async () => {
    process.env.IMGBB_API_KEY = "key";
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false, error: { message: "bad image" } }),
    }) as unknown as typeof fetch;
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "bad image" });
  });

  it("devolve a URL publica do arquivo", async () => {
    process.env.IMGBB_API_KEY = "key";
    pendingUploads.set("tok", {
      fileType: "image/jpeg",
      expiresAt: Date.now() + 60_000,
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: { url: "https://i.ibb.co/a.jpg" },
      }),
    }) as unknown as typeof fetch;
    const res = mockRes();
    await proxyUpload(requestWithBody("tok", Buffer.from("img")), res);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.imgbb.com/1/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.json).toHaveBeenCalledWith({
      fileUrl: "https://i.ibb.co/a.jpg",
    });
  });
});

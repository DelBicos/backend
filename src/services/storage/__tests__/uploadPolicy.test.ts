import { HttpError } from "../../../errors/HttpError";
import { assertAllowedImageType, assertHttpsUrl, buildObjectKey } from "../uploadPolicy";

describe("uploadPolicy", () => {
  it("aceita apenas imagens permitidas", () => {
    expect(assertAllowedImageType("image/JPEG")).toBe("jpg");
    expect(assertAllowedImageType("image/png")).toBe("png");
    expect(() => assertAllowedImageType("text/html")).toThrow(HttpError);
    expect(() => assertAllowedImageType(undefined)).toThrow(HttpError);
  });

  it("gera chave no servidor, isolada por usuario", () => {
    const key = buildObjectKey("avatars", 12, "image/png");
    expect(key).toMatch(/^avatars\/12\/[0-9a-f-]{36}\.png$/);
  });

  it("exige URL https valida", () => {
    expect(assertHttpsUrl("https://i.ibb.co/x.png", "avatar_uri")).toBe("https://i.ibb.co/x.png");
    expect(() => assertHttpsUrl("http://x.com/a.png", "avatar_uri")).toThrow(HttpError);
    expect(() => assertHttpsUrl("javascript:alert(1)", "avatar_uri")).toThrow(HttpError);
    expect(() => assertHttpsUrl(42, "avatar_uri")).toThrow(HttpError);
  });

  describe("http em localhost (emulador Azurite)", () => {
    const original = { env: process.env.ENVIRONMENT, node: process.env.NODE_ENV };
    afterEach(() => {
      process.env.ENVIRONMENT = original.env;
      process.env.NODE_ENV = original.node;
    });

    it("aceita fora de producao", () => {
      process.env.ENVIRONMENT = "development";
      const url = "http://127.0.0.1:10000/devstoreaccount1/uploads/a.png";
      expect(assertHttpsUrl(url, "avatar_uri")).toBe(url);
      expect(assertHttpsUrl("http://localhost:10000/x.png", "avatar_uri")).toContain("localhost");
    });

    it("recusa em producao e para hosts que nao sao locais", () => {
      process.env.ENVIRONMENT = "production";
      expect(() => assertHttpsUrl("http://127.0.0.1:10000/a.png", "avatar_uri")).toThrow(HttpError);
      process.env.ENVIRONMENT = "development";
      expect(() => assertHttpsUrl("http://exemplo.com/a.png", "avatar_uri")).toThrow(HttpError);
    });
  });
});

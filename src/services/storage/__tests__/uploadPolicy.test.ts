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
});

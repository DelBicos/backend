import { errorCode, errorMessage, errorStatus, isRecord } from "../errors.util";
import { asString, bodyOf } from "../requestBody.util";
import { escapeHtml } from "../html.util";
import { distanceKm, toCoordinate } from "../geo.util";
import type { Request } from "express";

describe("utils/errors.util", () => {
  it("reconhece objetos nao nulos", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("extrai a mensagem de Error, objeto, texto ou usa o padrao", () => {
    expect(errorMessage(new Error("falhou"))).toBe("falhou");
    expect(errorMessage({ message: "objeto" })).toBe("objeto");
    expect(errorMessage("texto")).toBe("texto");
    expect(errorMessage({ message: 1 })).toBe("Erro desconhecido");
    expect(errorMessage(42, "padrao")).toBe("padrao");
  });

  it("le status ou statusCode numericos", () => {
    expect(errorStatus({ status: 404 })).toBe(404);
    expect(errorStatus({ statusCode: 409 })).toBe(409);
    expect(errorStatus({ status: "500" })).toBeUndefined();
    expect(errorStatus("erro")).toBeUndefined();
  });

  it("le o codigo do erro quando e texto", () => {
    expect(errorCode({ code: "EADDRINUSE" })).toBe("EADDRINUSE");
    expect(errorCode({ code: 1 })).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe("utils/requestBody.util", () => {
  it("devolve o corpo como objeto ou vazio", () => {
    expect(bodyOf({ body: { a: 1 } } as unknown as Request)).toEqual({ a: 1 });
    expect(bodyOf({ body: undefined } as unknown as Request)).toEqual({});
  });

  it("aceita so texto nao vazio", () => {
    expect(asString("abc")).toBe("abc");
    expect(asString("")).toBeUndefined();
    expect(asString(3)).toBeUndefined();
  });
});

describe("utils/html.util", () => {
  it("escapa caracteres especiais e trata nulos", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("utils/geo.util", () => {
  it("calcula a distancia entre dois pontos", () => {
    expect(distanceKm(0, 0, 0, 0)).toBe(0);
    expect(distanceKm(-23.55, -46.63, -22.91, -43.17)).toBeCloseTo(361, -1);
  });

  it("converte coordenadas validas e rejeita vazias ou invalidas", () => {
    expect(toCoordinate("-23.5")).toBe(-23.5);
    expect(toCoordinate("")).toBeNull();
    expect(toCoordinate(null)).toBeNull();
    expect(toCoordinate("abc")).toBeNull();
  });
});

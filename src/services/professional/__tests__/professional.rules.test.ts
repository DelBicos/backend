import { HttpError } from "../../../errors/HttpError";
import {
  averageRating,
  MAX_DESCRIPTION_LENGTH,
  onlyDigits,
  parseDescription,
  parseDocuments,
  parseIsoDate,
  parseOptionalCoordinate,
  parseRadiusKm,
} from "../professional.rules";

describe("documentos", () => {
  it("remove formatacao", () => {
    expect(onlyDigits("123.456.789-01")).toBe("12345678901");
    expect(onlyDigits("")).toBeUndefined();
    expect(onlyDigits("---")).toBeUndefined();
  });

  it("exige CPF ou CNPJ", () => {
    expect(() => parseDocuments({})).toThrow(HttpError);
  });

  it("valida o tamanho de CPF (11) e CNPJ (14)", () => {
    expect(parseDocuments({ cpf: "123.456.789-01" })).toEqual({
      cpf: "12345678901",
      cnpj: undefined,
    });
    expect(parseDocuments({ cnpj: "12.345.678/0001-90" }).cnpj).toBe("12345678000190");
    expect(() => parseDocuments({ cpf: "1234567890" })).toThrow(HttpError);
    expect(() => parseDocuments({ cnpj: "123" })).toThrow(HttpError);
  });
});

describe("parseDescription", () => {
  it("exige descricao no cadastro", () => {
    expect(() => parseDescription(undefined, true)).toThrow(HttpError);
    expect(() => parseDescription("   ", true)).toThrow(HttpError);
  });

  it("e opcional na atualizacao e faz trim", () => {
    expect(parseDescription(undefined, false)).toBeUndefined();
    expect(parseDescription("  Eletricista  ", false)).toBe("Eletricista");
  });

  it("respeita o limite da coluna", () => {
    expect(parseDescription("a".repeat(MAX_DESCRIPTION_LENGTH), true)).toHaveLength(
      MAX_DESCRIPTION_LENGTH,
    );
    expect(() => parseDescription("a".repeat(MAX_DESCRIPTION_LENGTH + 1), true)).toThrow(
      HttpError,
    );
  });
});

describe("parseRadiusKm", () => {
  it("aceita zero e arredonda para baixo", () => {
    expect(parseRadiusKm(0)).toBe(0);
    expect(parseRadiusKm("12.9")).toBe(12);
  });

  it.each([-1, "abc", undefined, null, ""])("rejeita %p", (value) => {
    expect(() => parseRadiusKm(value)).toThrow(HttpError);
  });
});

describe("averageRating", () => {
  it("ignora notas nulas e arredonda", () => {
    expect(averageRating([5, 4, null, 4])).toEqual({ rating: 4.3, ratings_count: 3 });
    expect(averageRating([5, 4, 4], 2)).toEqual({ rating: 4.33, ratings_count: 3 });
  });

  it("retorna zero sem avaliacoes", () => {
    expect(averageRating([])).toEqual({ rating: 0, ratings_count: 0 });
  });
});

describe("parseIsoDate / parseOptionalCoordinate", () => {
  it("aceita apenas datas reais no formato AAAA-MM-DD", () => {
    expect(parseIsoDate("2026-10-05")).toBe("2026-10-05");
    expect(() => parseIsoDate("05/10/2026")).toThrow(HttpError);
    expect(() => parseIsoDate("2026-02-30")).toThrow(HttpError);
  });

  it("converte coordenadas validas", () => {
    expect(parseOptionalCoordinate("-23.5")).toBe(-23.5);
    expect(parseOptionalCoordinate("abc")).toBeUndefined();
    expect(parseOptionalCoordinate(undefined)).toBeUndefined();
  });
});

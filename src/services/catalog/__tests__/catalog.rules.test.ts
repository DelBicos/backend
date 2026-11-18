import { HttpError } from "../../../errors/HttpError";
import {
  CooldownTracker,
  normalizeAvailabilities,
  optionalPositiveId,
  parsePagination,
  parsePositiveId,
  resolvePrice,
  semanticDocument,
  toAvailabilityRows,
} from "../catalog.rules";

describe("parsePagination", () => {
  const defaults = { limit: 20, maxLimit: 100 };

  it("usa os padroes para valores ausentes ou invalidos", () => {
    expect(parsePagination(undefined, "abc", defaults)).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("aplica teto e piso no limite", () => {
    expect(parsePagination(1, 5000, defaults).limit).toBe(100);
    expect(parsePagination(1, -3, defaults).limit).toBe(1);
  });

  it("calcula o offset a partir da pagina", () => {
    expect(parsePagination("3", "10", defaults)).toEqual({ page: 3, limit: 10, offset: 20 });
  });
});

describe("ids", () => {
  it("parsePositiveId aceita inteiros positivos e rejeita o resto", () => {
    expect(parsePositiveId("7")).toBe(7);
    for (const invalid of ["0", "-1", "1.5", "abc", undefined]) {
      expect(() => parsePositiveId(invalid)).toThrow(HttpError);
    }
  });

  it("optionalPositiveId ignora valores invalidos", () => {
    expect(optionalPositiveId("4")).toBe(4);
    expect(optionalPositiveId("x")).toBeUndefined();
    expect(optionalPositiveId(undefined)).toBeUndefined();
  });
});

describe("resolvePrice", () => {
  it("price_cents tem precedencia e sincroniza price", () => {
    expect(resolvePrice({ price: 99, price_cents: 1550 })).toEqual({ price: 15.5, price_cents: 1550 });
  });

  it("converte price em centavos sem erro de ponto flutuante", () => {
    expect(resolvePrice({ price: "19.99" })).toEqual({ price: 19.99, price_cents: 1999 });
  });

  it("aceita zero e rejeita negativos", () => {
    expect(resolvePrice({ price: 0 })).toEqual({ price: 0, price_cents: 0 });
    expect(() => resolvePrice({ price: -1 })).toThrow(HttpError);
    expect(() => resolvePrice({ price_cents: -1 })).toThrow(HttpError);
  });

  it("retorna undefined quando nenhum preco foi informado", () => {
    expect(resolvePrice({})).toBeUndefined();
  });
});

describe("disponibilidade", () => {
  it("converte o formato da API em linhas do banco", () => {
    expect(toAvailabilityRows(3, [{ day: "1", start: "09:00", end: "12:00" }])).toEqual([
      { service_id: 3, day_of_week: 1, start_time: "09:00", end_time: "12:00" },
    ]);
  });

  it("normaliza horarios HH:MM:SS para HH:MM", () => {
    expect(
      normalizeAvailabilities([
        { id: 1, day_of_week: 2, start_time: "08:30:00", end_time: "17:00:00" },
      ]),
    ).toEqual([{ id: 1, day_of_week: 2, start_time: "08:30", end_time: "17:00" }]);
  });
});

describe("semanticDocument", () => {
  it("junta titulo, descricao, subcategoria e categoria ignorando vazios", () => {
    expect(
      semanticDocument({
        title: "Corte",
        description: "  ",
        Subcategory: { title: "Cabelo", Category: { title: "Beleza" } },
      }),
    ).toBe("Corte. Cabelo. Beleza");
  });
});

describe("CooldownTracker", () => {
  it("bloqueia repeticao dentro da janela e libera depois", () => {
    const cooldown = new CooldownTracker(10_000);
    expect(cooldown.hit(1, 0)).toBe(0);
    expect(cooldown.hit(1, 4_000)).toBe(6);
    expect(cooldown.hit(2, 4_000)).toBe(0);
    expect(cooldown.hit(1, 10_000)).toBe(0);
  });
});

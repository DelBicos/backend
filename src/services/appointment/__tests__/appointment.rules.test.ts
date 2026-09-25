import { HttpError } from "../../../errors/HttpError";
import {
  assertMinimumAdvance,
  assertProfessionalResponse,
  assertStatus,
  assertValidPeriod,
  assertValidReview,
  assertWithinServiceRadius,
} from "../appointment.rules";

const expectHttpError = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    return;
  }
  throw new Error("esperava HttpError");
};

describe("assertMinimumAdvance", () => {
  const now = new Date("2026-09-24T15:00:00");

  it("rejeita agendamento para amanha (menos de 2 dias)", () => {
    expectHttpError(() => assertMinimumAdvance(new Date("2026-09-25T10:00:00"), now), 400);
  });

  it("aceita exatamente o limite (daqui a 2 dias, 00:00)", () => {
    expect(() => assertMinimumAdvance(new Date("2026-09-26T00:00:00"), now)).not.toThrow();
  });

  it("rejeita data invalida", () => {
    expectHttpError(() => assertMinimumAdvance(new Date("invalida"), now), 400);
  });
});

describe("assertValidPeriod", () => {
  it("rejeita termino antes do inicio", () => {
    expectHttpError(
      () => assertValidPeriod(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-01T09:00:00Z")),
      400,
    );
  });

  it("aceita periodo valido", () => {
    expect(() =>
      assertValidPeriod(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-01T11:00:00Z")),
    ).not.toThrow();
  });
});

describe("assertWithinServiceRadius", () => {
  // Sorocaba centro -> Votorantim (~8 km)
  const base = {
    professionalLat: -23.5015,
    professionalLng: -47.4526,
    clientLat: -23.5446,
    clientLng: -47.4388,
  };

  it("aceita cliente dentro do raio", () => {
    expect(() => assertWithinServiceRadius({ ...base, radiusKm: 10 })).not.toThrow();
  });

  it("rejeita cliente fora do raio", () => {
    expectHttpError(() => assertWithinServiceRadius({ ...base, radiusKm: 2 }), 400);
  });

  it("ignora a regra quando faltam coordenadas ou raio", () => {
    expect(() =>
      assertWithinServiceRadius({ ...base, clientLat: null, radiusKm: 1 }),
    ).not.toThrow();
    expect(() => assertWithinServiceRadius({ ...base, radiusKm: null })).not.toThrow();
  });
});

describe("assertValidReview", () => {
  it.each([0, 6, 2.5, "abc"])("rejeita rating %p", (rating) => {
    expectHttpError(() => assertValidReview(rating, null), 400);
  });

  it("exige rating", () => {
    expectHttpError(() => assertValidReview(undefined, "ok"), 400);
  });

  it("aceita os limites 1 e 5", () => {
    expect(assertValidReview(1, null).rating).toBe(1);
    expect(assertValidReview("5", null).rating).toBe(5);
  });

  it("rejeita comentario acima de 500 caracteres e aceita exatamente 500", () => {
    expectHttpError(() => assertValidReview(4, "a".repeat(501)), 400);
    expect(assertValidReview(4, "a".repeat(500)).review).toHaveLength(500);
  });

  it("normaliza comentario vazio para null", () => {
    expect(assertValidReview(4, "   ").review).toBeNull();
  });
});

describe("transicoes de status", () => {
  it("aceita apenas confirmed/canceled como resposta do profissional", () => {
    expect(assertProfessionalResponse("confirmed")).toBe("confirmed");
    expect(assertProfessionalResponse("canceled")).toBe("canceled");
    expectHttpError(() => assertProfessionalResponse("completed"), 400);
  });

  it("assertStatus bloqueia status diferente do esperado", () => {
    expect(() => assertStatus("pending", "pending", "aceitar")).not.toThrow();
    expectHttpError(() => assertStatus("canceled", "pending", "aceitar"), 400);
  });
});

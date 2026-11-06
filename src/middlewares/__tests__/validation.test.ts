import type { NextFunction, Request, Response } from "express";
import { validateCreateService, validateCreateServiceTopLevel, validateUpdateService } from "../service.validation";
import { validateCreateAvailability, validateUpdateAvailability } from "../availability.validation";
import { validateCreateLock, validateUpdateLock } from "../availabilityLock.validation";

/** Executa o middleware e devolve { status, body } ou "next". */
function run(
  middleware: (req: Request, res: Response, next: NextFunction) => unknown,
  body: unknown,
) {
  let result: { status: number; body: { error?: string } } | "next" | undefined;
  const res = {
    status(status: number) {
      return { json: (payload: { error?: string }) => (result = { status, body: payload }) };
    },
  } as unknown as Response;
  middleware({ body } as Request, res, () => (result = "next"));
  return result;
}

const rejects = (result: ReturnType<typeof run>, text: string) => {
  expect(result).not.toBe("next");
  expect(result).toMatchObject({ status: 400 });
  expect((result as { body: { error?: string } }).body.error).toContain(text);
};

describe("validateCreateService", () => {
  const valid = { title: "Pintura", duration: 60, price: 100, subcategory_id: 3 };

  it("aceita servico valido com price ou price_cents", () => {
    expect(run(validateCreateService, valid)).toBe("next");
    const { price, ...rest } = valid;
    expect(run(validateCreateService, { ...rest, price_cents: 10000 })).toBe("next");
  });

  it("recusa titulo vazio, duracao invalida, preco ausente e subcategoria faltando", () => {
    rejects(run(validateCreateService, { ...valid, title: "  " }), "title");
    rejects(run(validateCreateService, { ...valid, duration: 0 }), "duration");
    rejects(run(validateCreateService, { ...valid, price: undefined }), "price");
    rejects(run(validateCreateService, { ...valid, price_cents: 1.5 }), "price_cents");
    rejects(run(validateCreateService, { ...valid, subcategory_id: undefined }), "subcategory_id");
  });

  it("valida a lista de disponibilidades", () => {
    rejects(run(validateCreateService, { ...valid, availabilities: "x" }), "array");
    rejects(
      run(validateCreateService, { ...valid, availabilities: [{ day: 9, start: "09:00", end: "10:00" }] }),
      "inválidas",
    );
    expect(
      run(validateCreateService, { ...valid, availabilities: [{ day: 1, start: "09:00", end: "10:00" }] }),
    ).toBe("next");
  });

  it("nao quebra com corpo ausente", () => {
    rejects(run(validateCreateService, undefined), "title");
  });
});

describe("validateCreateServiceTopLevel / validateUpdateService", () => {
  it("exige descricao e categoria no cadastro completo", () => {
    const base = { title: "T", description: "D", price: 10, category_id: 1, subcategory_id: 2 };
    expect(run(validateCreateServiceTopLevel, base)).toBe("next");
    rejects(run(validateCreateServiceTopLevel, { ...base, description: "" }), "description");
    rejects(run(validateCreateServiceTopLevel, { ...base, category_id: 0 }), "category_id");
  });

  it("na atualizacao valida so os campos enviados", () => {
    expect(run(validateUpdateService, {})).toBe("next");
    expect(run(validateUpdateService, { title: "Novo" })).toBe("next");
    rejects(run(validateUpdateService, { title: "" }), "title");
    rejects(run(validateUpdateService, { duration: -1 }), "duration");
    rejects(run(validateUpdateService, { price: "abc" }), "price");
    rejects(run(validateUpdateService, { availabilities: {} }), "array");
  });
});

describe("validateCreateAvailability", () => {
  const weekly = { start_time: "09:00", end_time: "12:00", recurrence_pattern: "weekly", days_of_week: "0111110" };

  it("aceita janelas validas de cada recorrencia", () => {
    expect(run(validateCreateAvailability, weekly)).toBe("next");
    expect(
      run(validateCreateAvailability, { start_time: "09:00:00", end_time: "10:00:00", recurrence_pattern: "monthly", start_day_of_month: 5 }),
    ).toBe("next");
    expect(
      run(validateCreateAvailability, { start_time: "09:00", end_time: "10:00", recurrence_pattern: "none", start_day: "2030-01-01", end_day: "2030-01-02" }),
    ).toBe("next");
  });

  it("recusa horarios mal formatados ou invertidos", () => {
    rejects(run(validateCreateAvailability, { ...weekly, start_time: "9h" }), "start_time");
    rejects(run(validateCreateAvailability, { ...weekly, end_time: undefined }), "end_time");
    rejects(run(validateCreateAvailability, { ...weekly, start_time: "13:00" }), "menor");
    rejects(run(validateCreateAvailability, { ...weekly, start_time: 900 }), "start_time");
  });

  it("exige os campos da recorrencia escolhida", () => {
    rejects(run(validateCreateAvailability, { ...weekly, days_of_week: "11" }), "days_of_week");
    rejects(run(validateCreateAvailability, { ...weekly, recurrence_pattern: "monthly" }), "start_day_of_month");
    rejects(run(validateCreateAvailability, { ...weekly, recurrence_pattern: "none" }), "start_day");
  });
});

describe("validateUpdateAvailability", () => {
  it("valida apenas o que foi enviado", () => {
    expect(run(validateUpdateAvailability, {})).toBe("next");
    rejects(run(validateUpdateAvailability, { start_time: "25h" }), "start_time");
    rejects(run(validateUpdateAvailability, { days_of_week: "abc" }), "days_of_week");
    rejects(run(validateUpdateAvailability, { start_time: "12:00", end_time: "10:00" }), "menor");
  });
});

describe("bloqueios (lock)", () => {
  it("criacao exige datas ISO validas e inicio antes do fim", () => {
    expect(run(validateCreateLock, { start_time: "2030-01-01T10:00:00Z", end_time: "2030-01-01T11:00:00Z" })).toBe("next");
    rejects(run(validateCreateLock, { start_time: "nao-data", end_time: "2030-01-01T11:00:00Z" }), "start_time");
    rejects(run(validateCreateLock, { start_time: 123, end_time: "2030-01-01T11:00:00Z" }), "start_time");
    rejects(run(validateCreateLock, { start_time: "2030-01-02T10:00:00Z", end_time: "2030-01-01T11:00:00Z" }), "menor");
  });

  it("atualizacao exige ao menos um campo e valida a ordem", () => {
    rejects(run(validateUpdateLock, {}), "Forneça");
    expect(run(validateUpdateLock, { new_end_time: "2030-01-01T11:00:00Z" })).toBe("next");
    rejects(run(validateUpdateLock, { new_start_time: "x" }), "new_start_time");
    rejects(
      run(validateUpdateLock, { new_start_time: "2030-01-02T10:00:00Z", new_end_time: "2030-01-01T10:00:00Z" }),
      "menor",
    );
  });
});

import type { NextFunction, Request, Response } from "express";
import { validateCreateTicket } from "../ticket.validation";

type Detail = { field: string; message: string };
type Result = { status: number; body: { error?: string; details?: Detail[] } } | "next" | undefined;

/** Executa o middleware e devolve { status, body } ou "next", além do req (body já tratado). */
function run(body: unknown) {
  let result: Result;
  const req = { body } as Request;
  const res = {
    status(status: number) {
      return { json: (payload: { error?: string; details?: Detail[] }) => (result = { status, body: payload }) };
    },
  } as unknown as Response;
  validateCreateTicket(req, res, (() => (result = "next")) as NextFunction);
  return { result, req };
}

/** Confirma 400 "Dados inválidos." apontando o campo recusado. */
const rejects = (body: unknown, field: string) => {
  const { result } = run(body);
  expect(result).not.toBe("next");
  expect(result).toMatchObject({ status: 400, body: { error: "Dados inválidos." } });
  const fields = (result as { body: { details: Detail[] } }).body.details.map((d) => d.field);
  expect(fields).toContain(field);
};

describe("validateCreateTicket (TICKET-01 / TICKET-02)", () => {
  const valid = {
    title: "Erro ao agendar serviço",
    description: "Não consigo agendar um serviço de limpeza para amanhã.",
    category: "AGENDAMENTO",
    priority: "ALTA",
  };

  it("aceita chamado com título, descrição, categoria e prioridade", () => {
    expect(run(valid).result).toBe("next");
    expect(run({ ...valid, appointment_short_id: "6BDOKZ" }).result).toBe("next");
  });

  it.each(["BAIXA", "MEDIA", "ALTA", "CRITICA"])("aceita a prioridade %s", (priority) => {
    expect(run({ ...valid, priority }).result).toBe("next");
  });

  it.each(["AGENDAMENTO", "PAGAMENTO", "SERVICO", "PRESTADOR", "CLIENTE", "SUGESTAO", "OUTROS"])(
    "aceita a categoria %s",
    (category) => {
      expect(run({ ...valid, category }).result).toBe("next");
    },
  );

  it("exige prioridade e recusa valores fora do enum", () => {
    rejects({ ...valid, priority: undefined }, "priority");
    rejects({ ...valid, priority: "URGENTE" }, "priority");
    rejects({ ...valid, priority: "alta" }, "priority");
  });

  it("valida os limites de título e descrição (valor limite)", () => {
    expect(run({ ...valid, title: "A".repeat(5) }).result).toBe("next");
    expect(run({ ...valid, title: "A".repeat(100) }).result).toBe("next");
    rejects({ ...valid, title: "A".repeat(4) }, "title");
    rejects({ ...valid, title: "A".repeat(101) }, "title");

    expect(run({ ...valid, description: "A".repeat(10) }).result).toBe("next");
    expect(run({ ...valid, description: "A".repeat(2000) }).result).toBe("next");
    rejects({ ...valid, description: "A".repeat(9) }, "description");
    rejects({ ...valid, description: "A".repeat(2001) }, "description");
  });

  it("recusa categoria inválida e código de agendamento malformado", () => {
    rejects({ ...valid, category: "INVALIDA" }, "category");
    rejects({ ...valid, appointment_short_id: "abc" }, "appointment_short_id");
    rejects({ ...valid, appointment_short_id: "6bdokz" }, "appointment_short_id");
  });

  it("lista todos os campos obrigatórios quando o body vem vazio", () => {
    const { result } = run({});
    const fields = (result as { body: { details: Detail[] } }).body.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "description", "category", "priority"]));
  });

  it("descarta campos que o usuário não pode definir (status, user_type, user_id)", () => {
    const { result, req } = run({ ...valid, status: "RESOLVIDO", user_type: "PRESTADOR", user_id: 99 });
    expect(result).toBe("next");
    expect(req.body).toEqual(valid);
  });

  it("remove espaços nas pontas de título e descrição", () => {
    const { req } = run({ ...valid, title: "  Erro ao agendar  ", description: "  Descrição com espaços  " });
    expect(req.body.title).toBe("Erro ao agendar");
    expect(req.body.description).toBe("Descrição com espaços");
  });
});

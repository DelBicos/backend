/**
 * Integração da Central de Ajuda (TICKET-01, TICKET-02, TICKET-03).
 *
 * Roda só contra o PostgreSQL local descartável de PR2_TEST_DATABASE_URL
 * (docker-compose.test.yml), num banco próprio (`pr2_test_ticket`) recriado a
 * partir das migrations reais. Nunca usa o banco do .env principal (Neon).
 */
const TEST_DATABASE = "pr2_test_ticket";

jest.mock("../../../config/database", () => {
  const { Sequelize } = require("sequelize");
  const mongoose = require("mongoose");
  const uri = process.env.PR2_TEST_DATABASE_URL;
  if (!uri)
    throw new Error(
      "Defina PR2_TEST_DATABASE_URL para um PostgreSQL local isolado (banco pr2_test).",
    );
  const url = new URL(uri);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/pr2_test"
  ) {
    throw new Error("Testes destrutivos permitidos somente no banco local pr2_test.");
  }
  url.pathname = "/pr2_test_ticket";
  return {
    sequelize: new Sequelize(url.toString(), { logging: false, pool: { max: 4 } }),
    chatMongoConnection: mongoose.createConnection(),
    isChatMongoReady: () => false,
    connectDatabase: async () => undefined,
    connectMongo: async () => undefined,
  };
});

import request from "supertest";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { createApp } from "../../../app";
import { sequelize } from "../../../config/database";
import { initializeAssociations } from "../../../models/associations";
import Ticket from "../../../models/Ticket";
import TicketMessageModel from "../../../models/TicketMessage";
import { ProfessionalModel } from "../../../models/Professional";
import { AdminModel } from "../../../models/Admin";
import { UserModel } from "../../../models/User";
import { ensureTestDatabase, resetSchema } from "../../../__tests__/helpers/resetSchema";

// Criar o banco e aplicar as migrations leva bem mais que os 5 s padrão do Jest.
jest.setTimeout(60_000);

let app: Express;
let clientId: number;
let professionalId: number;
let clientToken: string;
let professionalToken: string;
let adminToken: string;

const tokenFor = (user: { id: number; name: string; email: string; phone: string }) =>
  jwt.sign({ user }, process.env.SECRET_KEY || "secret", { expiresIn: "1h" });

const createUser = async (name: string, email: string, phone: string) => {
  const user = await UserModel.create({ name, email, phone, password: "senha123" });
  return { user, token: tokenFor({ id: user.id, name, email, phone }) };
};

const validPayload = {
  title: "Erro ao agendar serviço",
  description: "Não consigo agendar um serviço de limpeza para amanhã.",
  category: "AGENDAMENTO",
  priority: "ALTA",
} as const;

const openTicket = (token: string, body: object = validPayload) =>
  request(app).post("/api/tickets").set("Authorization", `Bearer ${token}`).send(body);

beforeAll(async () => {
  await ensureTestDatabase(process.env.PR2_TEST_DATABASE_URL as string, TEST_DATABASE);
  await resetSchema();
  initializeAssociations();
  app = createApp();

  const client = await createUser("Cliente Teste", "cliente@ticket.test", "11999999999");
  clientId = client.user.id;
  clientToken = client.token;

  const professional = await createUser("Prestador Teste", "prestador@ticket.test", "11988888888");
  professionalId = professional.user.id;
  professionalToken = professional.token;
  await ProfessionalModel.create({
    user_id: professionalId,
    cpf: "12345678901",
    description: "Prestador de teste",
  });

  const admin = await createUser("Admin Teste", "admin@ticket.test", "11977777777");
  adminToken = admin.token;
  await AdminModel.create({ user_id: admin.user.id });
}, 300_000);

afterAll(async () => {
  await sequelize.close();
});

beforeEach(async () => {
  await TicketMessageModel.destroy({ where: {} });
  await Ticket.destroy({ where: {} });
});

describe("TICKET-01 — cliente abre chamado", () => {
  it("cria o chamado com título, descrição, categoria e prioridade", async () => {
    const res = await openTicket(clientToken);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Chamado aberto com sucesso.");
    expect(res.body.ticket).toMatchObject({
      title: validPayload.title,
      category: "AGENDAMENTO",
      priority: "ALTA",
      status: "ABERTO",
    });
    expect(res.body.ticket.ticket_code).toMatch(/^TKT-[A-Z0-9]{4}$/);
    expect(res.body.ticket.created_at).toBeDefined();

    const saved = await Ticket.findByPk(res.body.ticket.id);
    expect(saved).toMatchObject({
      user_id: clientId,
      user_type: "CLIENTE",
      priority: "ALTA",
      status: "ABERTO",
      description: validPayload.description,
    });
  });

  it.each(["BAIXA", "MEDIA", "ALTA", "CRITICA"])("aceita a prioridade %s", async (priority) => {
    const res = await openTicket(clientToken, { ...validPayload, priority });
    expect(res.status).toBe(201);
    expect(res.body.ticket.priority).toBe(priority);
  });

  it("sempre abre com status ABERTO, mesmo se o body tentar outro", async () => {
    const res = await openTicket(clientToken, { ...validPayload, status: "RESOLVIDO" });
    expect(res.status).toBe(201);
    expect((await Ticket.findByPk(res.body.ticket.id))?.status).toBe("ABERTO");
  });

  it("gera códigos diferentes para chamados diferentes", async () => {
    const r1 = await openTicket(clientToken);
    const r2 = await openTicket(clientToken);
    expect(r1.body.ticket.ticket_code).not.toBe(r2.body.ticket.ticket_code);
  });

  it("rejeita agendamento inexistente", async () => {
    const res = await openTicket(clientToken, { ...validPayload, appointment_short_id: "NAOEXISTE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("NAOEXISTE");
  });
});

describe("Validação do POST /api/tickets", () => {
  it.each([
    ["título curto", { title: "Err" }, "title"],
    ["título longo", { title: "A".repeat(101) }, "title"],
    ["descrição curta", { description: "Curta" }, "description"],
    ["descrição longa", { description: "A".repeat(2001) }, "description"],
    ["categoria inválida", { category: "INVALIDA" }, "category"],
    ["prioridade inválida", { priority: "URGENTE" }, "priority"],
    ["sem prioridade", { priority: undefined }, "priority"],
    ["agendamento com formato inválido", { appointment_short_id: "abc" }, "appointment_short_id"],
  ])("rejeita %s com 400", async (_label, override, field) => {
    const res = await openTicket(clientToken, { ...validPayload, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Dados inválidos.");
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it("lista todos os campos obrigatórios quando o body vem vazio", async () => {
    const res = await openTicket(clientToken, {});
    expect(res.status).toBe(400);
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "description", "category", "priority"]));
  });
});

describe("TICKET-02 — prestador abre chamado", () => {
  it("cria o chamado com user_type PRESTADOR e a prioridade enviada", async () => {
    const res = await openTicket(professionalToken, {
      ...validPayload,
      title: "Cliente não apareceu no local",
      category: "CLIENTE",
      priority: "MEDIA",
    });

    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatchObject({ category: "CLIENTE", priority: "MEDIA", status: "ABERTO" });
    const saved = await Ticket.findByPk(res.body.ticket.id);
    expect(saved).toMatchObject({ user_id: professionalId, user_type: "PRESTADOR" });
  });

  it("bloqueia administrador com 403 e não grava nada", async () => {
    const res = await openTicket(adminToken);
    expect(res.status).toBe(403);
    expect(await Ticket.count()).toBe(0);
  });
});

describe("Autenticação", () => {
  it("responde 401 sem token", async () => {
    const res = await request(app).post("/api/tickets").send(validPayload);
    expect(res.status).toBe(401);
  });

  it("responde 403 com token inválido", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("Authorization", "Bearer token-invalido");
    expect(res.status).toBe(403);
  });
});

describe("TICKET-03 — visualizar chamados com status atual", () => {
  it("lista só os chamados do usuário, mais recentes primeiro, com status e prioridade", async () => {
    const first = await openTicket(clientToken, { ...validPayload, title: "Primeiro chamado" });
    const second = await openTicket(clientToken, { ...validPayload, title: "Segundo chamado" });
    await openTicket(professionalToken);

    const res = await request(app).get("/api/tickets").set("Authorization", `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tickets.map((t: { id: number }) => t.id)).toEqual([
      second.body.ticket.id,
      first.body.ticket.id,
    ]);
    for (const ticket of res.body.tickets) {
      expect(ticket).toEqual(
        expect.objectContaining({
          ticket_code: expect.any(String),
          status: "ABERTO",
          priority: "ALTA",
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
    }
  });

  it("mostra o status atual depois que ele muda", async () => {
    const created = await openTicket(clientToken);
    await Ticket.update({ status: "EM_ATENDIMENTO" }, { where: { id: created.body.ticket.id } });

    const list = await request(app).get("/api/tickets").set("Authorization", `Bearer ${clientToken}`);
    expect(list.body.tickets[0].status).toBe("EM_ATENDIMENTO");

    const detail = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(detail.body.ticket.status).toBe("EM_ATENDIMENTO");
  });

  it("retorna lista vazia para quem não tem chamados", async () => {
    const res = await request(app).get("/api/tickets").set("Authorization", `Bearer ${professionalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
  });

  it("detalha o próprio chamado", async () => {
    const created = await openTicket(clientToken);
    const res = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set("Authorization", `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      ticket_code: created.body.ticket.ticket_code,
      description: validPayload.description,
      priority: "ALTA",
      status: "ABERTO",
      user_type: "CLIENTE",
    });
  });

  it("responde 404 para chamado de outro usuário", async () => {
    const created = await openTicket(clientToken);
    const res = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set("Authorization", `Bearer ${professionalToken}`);
    expect(res.status).toBe(404);
  });

  it("responde 404 para ID inexistente", async () => {
    const res = await request(app).get("/api/tickets/999999").set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(404);
  });

  it.each(["abc", "1.5", "0", "-3"])("responde 400 para ID inválido (%s)", async (id) => {
    const res = await request(app).get(`/api/tickets/${id}`).set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tickets/:id/messages", () => {
  it("lista o histórico do próprio chamado em ordem cronológica", async () => {
    const created = await openTicket(clientToken);
    const ticketId = created.body.ticket.id;
    await TicketMessageModel.create({ ticket_id: ticketId, author_id: clientId, author_type: "CLIENTE", content: "Primeira" });
    await TicketMessageModel.create({ ticket_id: ticketId, author_id: clientId, author_type: "CLIENTE", content: "Segunda" });

    const res = await request(app)
      .get(`/api/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(["Primeira", "Segunda"]);
    expect(res.body.messages[0].author).toMatchObject({ id: clientId, type: "CLIENTE", name: "Cliente Teste" });
  });

  it("responde 404 para chamado de outro usuário", async () => {
    const created = await openTicket(clientToken);
    const res = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}/messages`)
      .set("Authorization", `Bearer ${professionalToken}`);
    expect(res.status).toBe(404);
  });
});

describe("TICKET-05 — adicionar mensagem em chamado aberto", () => {
  const postMessage = (token: string, ticketId: number | string, body: object) =>
    request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  it("grava a mensagem do cliente e ela aparece no histórico", async () => {
    const created = await openTicket(clientToken);
    const ticketId = created.body.ticket.id;

    const res = await postMessage(clientToken, ticketId, { content: "  Ainda sem resposta  " });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Mensagem adicionada com sucesso.");
    expect(res.body.ticket_message).toMatchObject({
      ticket_id: ticketId,
      author: { id: clientId, type: "CLIENTE", name: "Cliente Teste" },
      content: "Ainda sem resposta",
      attachment_url: null,
    });

    const history = await request(app)
      .get(`/api/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(history.body.messages).toHaveLength(1);
    expect(history.body.messages[0]).toEqual(res.body.ticket_message);
  });

  it("grava como PRESTADOR quando o chamado é do prestador", async () => {
    const created = await openTicket(professionalToken);

    const res = await postMessage(professionalToken, created.body.ticket.id, { content: "Cliente não respondeu" });

    expect(res.status).toBe(201);
    expect(res.body.ticket_message.author).toMatchObject({ id: professionalId, type: "PRESTADOR" });
  });

  it("mantém a ordem cronológica com várias mensagens", async () => {
    const created = await openTicket(clientToken);
    const ticketId = created.body.ticket.id;
    await postMessage(clientToken, ticketId, { content: "Primeira" });
    await postMessage(clientToken, ticketId, { content: "Segunda" });

    const history = await request(app)
      .get(`/api/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(history.body.messages.map((m: { content: string }) => m.content)).toEqual(["Primeira", "Segunda"]);
  });

  it("atualiza o updated_at do chamado", async () => {
    const created = await openTicket(clientToken);
    const ticketId = created.body.ticket.id;
    const before = (await Ticket.findByPk(ticketId))!.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 20));
    await postMessage(clientToken, ticketId, { content: "Nova interação" });

    const after = (await Ticket.findByPk(ticketId))!.updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("ignora autor e anexo enviados no body", async () => {
    const created = await openTicket(clientToken);

    const res = await postMessage(clientToken, created.body.ticket.id, {
      content: "Oi",
      author_id: professionalId,
      author_type: "ADMIN",
      attachment_url: "https://exemplo.com/x.png",
    });

    expect(res.status).toBe(201);
    expect(res.body.ticket_message.author).toMatchObject({ id: clientId, type: "CLIENTE" });
    expect(res.body.ticket_message.attachment_url).toBeNull();
  });

  it.each(["EM_ANALISE", "EM_ATENDIMENTO"] as const)("aceita mensagem com status %s", async (status) => {
    const created = await openTicket(clientToken);
    await Ticket.update({ status }, { where: { id: created.body.ticket.id } });

    const res = await postMessage(clientToken, created.body.ticket.id, { content: "Oi" });
    expect(res.status).toBe(201);
  });

  it.each(["RESOLVIDO", "FECHADO"] as const)("responde 409 TICKET_CLOSED e não grava com status %s", async (status) => {
    const created = await openTicket(clientToken);
    await Ticket.update({ status }, { where: { id: created.body.ticket.id } });

    const res = await postMessage(clientToken, created.body.ticket.id, { content: "Oi" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Chamado encerrado não aceita novas mensagens.", code: "TICKET_CLOSED" });
    expect(await TicketMessageModel.count({ where: { ticket_id: created.body.ticket.id } })).toBe(0);
  });

  it("responde 404 e não grava em chamado de outro usuário", async () => {
    const created = await openTicket(clientToken);

    const res = await postMessage(professionalToken, created.body.ticket.id, { content: "Oi" });

    expect(res.status).toBe(404);
    expect(await TicketMessageModel.count()).toBe(0);
  });

  it("responde 404 para chamado inexistente", async () => {
    const res = await postMessage(clientToken, 999999, { content: "Oi" });
    expect(res.status).toBe(404);
  });

  it.each([
    ["sem conteúdo", {}],
    ["conteúdo vazio", { content: "" }],
    ["só espaços", { content: "    " }],
    ["mais de 2000 caracteres", { content: "A".repeat(2001) }],
  ])("responde 400 para mensagem %s", async (_label, body) => {
    const created = await openTicket(clientToken);

    const res = await postMessage(clientToken, created.body.ticket.id, body);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: "content" })]));
  });

  it("responde 400 para ID inválido e 401 sem token", async () => {
    expect((await postMessage(clientToken, "abc", { content: "Oi" })).status).toBe(400);
    expect((await request(app).post("/api/tickets/1/messages").send({ content: "Oi" })).status).toBe(401);
  });
});

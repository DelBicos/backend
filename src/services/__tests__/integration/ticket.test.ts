import request from "supertest";
import app from "../../../../server";
import Ticket from "../../../models/Ticket";
import { UserModel } from "../../../models/User";
import jwt from "jsonwebtoken";

describe("TICKET-01 — Criação de Chamado", () => {
  let clientToken: string;
  let professionalToken: string;
  let clientId: number;
  let professionalId: number;

  beforeAll(async () => {
    await Ticket.destroy({ where: {} });

    // ─────────────────────────────────────────────
    //  USUÁRIOS REAIS (criados pelos seeders)
    // ─────────────────────────────────────────────

    // Cliente — não é profissional
    const client = await UserModel.findByPk(31);
    if (!client) throw new Error("❌ Cliente id=31 não encontrado. Rode os seeders.");
    clientId = client.id;

    // Prestador — Douglas é professional
    const professional = await UserModel.findByPk(3);
    if (!professional) throw new Error("❌ Douglas (id=3) não encontrado.");
    professionalId = professional.id;

    // ─────────────────────────────────────────────
    //  TOKENS JWT
    // ─────────────────────────────────────────────
    const secret = process.env.SECRET_KEY || "secret";

    clientToken = jwt.sign(
      {
        user: {
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
        },
      },
      secret,
      { expiresIn: "1h" }
    );

    professionalToken = jwt.sign(
      {
        user: {
          id: professional.id,
          name: professional.name,
          email: professional.email,
          phone: professional.phone,
        },
      },
      secret,
      { expiresIn: "1h" }
    );

    console.log(`✅ Cliente: ${client.email} (id=${client.id})`);
    console.log(`✅ Prestador: ${professional.email} (id=${professional.id})`);
  });

  afterAll(async () => {
    // Limpa apenas os tickets criados nos testes (não mexe em users)
    await Ticket.destroy({ where: {} });
  });

  const validPayload = {
    title: "Erro ao agendar serviço",
    description: "Não consigo agendar um serviço de limpeza para amanhã.",
    category: "AGENDAMENTO" as const,
  };

  /* ============================================================
   *  SUCESSO
   * ============================================================ */

  it("deve criar chamado para cliente autenticado", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Chamado aberto com sucesso.");
    expect(response.body.ticket).toHaveProperty("id");
    expect(response.body.ticket.ticket_code).toMatch(/^TKT-[A-Z0-9]{4}$/);
    expect(response.body.ticket.title).toBe(validPayload.title);
    expect(response.body.ticket.category).toBe("AGENDAMENTO");
    expect(response.body.ticket.status).toBe("ABERTO");
    expect(response.body.ticket.priority).toBeNull();
    expect(response.body.ticket.created_at).toBeDefined();
  });

  it("deve criar chamado para prestador autenticado (Douglas)", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`)
      .send({
        ...validPayload,
        category: "CLIENTE",
        title: "Cliente não apareceu no local",
      });

    expect(response.status).toBe(201);
    expect(response.body.ticket.priority).toBeNull();
    expect(response.body.ticket.category).toBe("CLIENTE");
  });

  it("deve persistir priority como NULL quando não informada", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const ticket = await Ticket.findByPk(response.body.ticket.id);
    expect(ticket).not.toBeNull();
    expect(ticket?.priority).toBeNull();
  });

  /* ============================================================
   *  VALIDAÇÃO (400)
   * ============================================================ */

  it("deve rejeitar título com menos de 5 caracteres", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, title: "Err" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Dados inválidos.");
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "title" })])
    );
  });

  it("deve rejeitar título com mais de 100 caracteres", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, title: "A".repeat(101) });

    expect(response.status).toBe(400);
  });

  it("deve rejeitar descrição com menos de 10 caracteres", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, description: "Curta" });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "description" }),
      ])
    );
  });

  it("deve rejeitar descrição com mais de 2000 caracteres", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, description: "A".repeat(2001) });

    expect(response.status).toBe(400);
  });

  it("deve rejeitar categoria inválida", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, category: "INVALIDA" });

    expect(response.status).toBe(400);
  });

  it("deve rejeitar payload sem campos obrigatórios", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.details.length).toBeGreaterThanOrEqual(3);
  });

  it("deve ignorar priority mesmo quando enviada", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, priority: "CRITICA" });

    expect(response.status).toBe(201);

    const ticket = await Ticket.findByPk(response.body.ticket.id);
    expect(ticket?.priority).toBeNull();
  });

  /* ============================================================
   *  AUTENTICAÇÃO (401 / 403)
   * ============================================================ */

  it("deve retornar 401 quando não houver token", async () => {
    const response = await request(app).post("/api/tickets").send(validPayload);

    expect(response.status).toBe(401);
    expect(response.body.msg).toContain("token JWT");
  });

  it("deve retornar 403 quando o token for inválido", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", "Bearer token-invalido")
      .send(validPayload);

    expect(response.status).toBe(403);
  });

  /* ============================================================
   *  LISTAGEM (GET /api/tickets)
   * ============================================================ */

  it("deve listar chamados do cliente autenticado", async () => {
    await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const response = await request(app)
      .get("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.tickets)).toBe(true);
    expect(response.body.tickets.length).toBeGreaterThan(0);
    expect(response.body.tickets[0]).toHaveProperty("ticket_code");
    expect(response.body.tickets[0]).toHaveProperty("status");
  });

  it("deve retornar lista vazia para prestador sem chamados", async () => {
    await Ticket.destroy({ where: { user_id: professionalId } });

    const response = await request(app)
      .get("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tickets.length).toBe(0);
  });

  it("não deve listar chamados de outro usuário", async () => {
    // Cria chamado do cliente
    await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    // Lista como prestador
    const response = await request(app)
      .get("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`);

    expect(response.status).toBe(200);

    // Todos os tickets da resposta são do prestador
    for (const t of response.body.tickets) {
      const dbTicket = await Ticket.findByPk(t.id);
      expect(dbTicket?.user_id).toBe(professionalId);
    }
  });

  /* ============================================================
   *  DETALHES (GET /api/tickets/:id)
   * ============================================================ */

  it("deve retornar detalhes de um chamado do próprio usuário", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const response = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.ticket.ticket_code).toBe(
      created.body.ticket.ticket_code
    );
    expect(response.body.ticket.description).toBe(validPayload.description);
  });

  it("deve retornar 404 ao buscar chamado de outro usuário", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const response = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set("Authorization", `Bearer ${professionalToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Chamado não encontrado.");
  });

  it("deve retornar 404 para ID inexistente", async () => {
    const response = await request(app)
      .get("/api/tickets/999999")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.status).toBe(404);
  });

  it("deve retornar 400 para ID inválido (não numérico)", async () => {
    const response = await request(app)
      .get("/api/tickets/abc")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.status).toBe(400);
  });

  /* ============================================================
   *  REGRA DE NEGÓCIO
   * ============================================================ */

  it("deve marcar user_type como CLIENTE para usuário sem professional", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const ticket = await Ticket.findByPk(response.body.ticket.id);
    expect(ticket?.user_type).toBe("CLIENTE");
  });

  it("deve marcar user_type como PRESTADOR para usuário com professional", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`)
      .send(validPayload);

    const ticket = await Ticket.findByPk(response.body.ticket.id);
    expect(ticket?.user_type).toBe("PRESTADOR");
  });

  it("deve gerar ticket_code único para cada chamado", async () => {
    const r1 = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const r2 = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, title: "Outro problema" });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.ticket.ticket_code).not.toBe(r2.body.ticket.ticket_code);
  });

  it("deve persistir status ABERTO por padrão", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const ticket = await Ticket.findByPk(response.body.ticket.id);
    expect(ticket?.status).toBe("ABERTO");
  });
});
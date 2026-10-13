import request from "supertest";
import app from "../../../server";
import { TicketModel } from "../../models/TicketModel";
import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import jwt from "jsonwebtoken";

describe("TICKET-01 – Criação de Chamado", () => {
  let clientToken: string;
  let professionalToken: string;
  let clientId: number;
  let professionalId: number;

  beforeAll(async () => {
    // Limpar tabelas relacionadas
    await TicketModel.destroy({ where: {}, truncate: true, cascade: true });
    await ProfessionalModel.destroy({ where: {}, truncate: true, cascade: true });

    // Criar usuário CLIENTE
    const client = await UserModel.create({
      name: "Cliente Teste",
      email: "cliente@teste.com",
      phone: "11999999999",
      password: "senha123",
    });
    clientId = client.id;

    // Criar usuário PRESTADOR
    const professionalUser = await UserModel.create({
      name: "Prestador Teste",
      email: "prestador@teste.com",
      phone: "11988888888",
      password: "senha123",
    });
    professionalId = professionalUser.id;

    // Vincular prestador na tabela professional
    await ProfessionalModel.create({
      user_id: professionalId,
      cpf: "12345678901",
      description: "Prestador de teste",
    });

    // Gerar tokens
    clientToken = jwt.sign(
      { user: { id: clientId, name: "Cliente Teste", email: "cliente@teste.com", phone: "11999999999" } },
      process.env.SECRET_KEY || "secret",
      { expiresIn: "1h" }
    );

    professionalToken = jwt.sign(
      { user: { id: professionalId, name: "Prestador Teste", email: "prestador@teste.com", phone: "11988888888" } },
      process.env.SECRET_KEY || "secret",
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await TicketModel.destroy({ where: {}, truncate: true, cascade: true });
    await ProfessionalModel.destroy({ where: {}, truncate: true, cascade: true });
  });

  const validPayload = {
    title: "Erro ao agendar serviço",
    description: "Não consigo agendar um serviço de limpeza para amanhã.",
    category: "AGENDAMENTO" as const,
    priority: "ALTA" as const,
  };

  // ============================================================
  // CENÁRIOS DE SUCESSO
  // ============================================================

  it("deve criar chamado quando o cliente autenticado envia dados válidos", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body.ticket).toHaveProperty("id");
    expect(response.body.ticket.ticket_code).toMatch(/^TKT-[A-Z0-9]{4}$/);
    expect(response.body.ticket.title).toBe(validPayload.title);
    expect(response.body.ticket.category).toBe("AGENDAMENTO");
    expect(response.body.ticket.priority).toBe("ALTA");
    expect(response.body.ticket.status).toBe("ABERTO");
  });

  it("deve criar chamado quando o prestador autenticado envia dados válidos", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`)
      .send({
        ...validPayload,
        category: "CLIENTE",
        title: "Cliente não apareceu no local",
      });

    expect(response.status).toBe(201);
    expect(response.body.ticket.status).toBe("ABERTO");
  });

  it("deve criar chamado com appointment_id quando informado", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, appointment_id: 123 });

    expect(response.status).toBe(201);
    expect(response.body.ticket).toHaveProperty("id");
  });

  // ============================================================
  // CENÁRIOS DE VALIDAÇÃO (400)
  // ============================================================

  it("deve rejeitar título com menos de 5 caracteres", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, title: "Err" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Dados inválidos.");
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "title" }),
      ])
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
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "category" }),
      ])
    );
  });

  it("deve rejeitar prioridade inválida", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, priority: "URGENTE" });

    expect(response.status).toBe(400);
  });

  it("deve rejeitar payload sem campos obrigatórios", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.details.length).toBeGreaterThanOrEqual(4);
  });

  // ============================================================
  // CENÁRIOS DE AUTENTICAÇÃO (401 / 403)
  // ============================================================

  it("deve retornar 401 quando não houver token", async () => {
    const response = await request(app).post("/api/tickets").send(validPayload);

    expect(response.status).toBe(401);
  });

  it("deve retornar 403 quando o token for inválido", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", "Bearer token-invalido")
      .send(validPayload);

    expect(response.status).toBe(403);
  });

  // ============================================================
  // REGRA DE NEGÓCIO
  // ============================================================

  it("deve marcar user_type como CLIENTE para usuário sem registro em professional", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    expect(response.status).toBe(201);

    const ticket = await TicketModel.findByPk(response.body.ticket.id);
    expect(ticket?.user_type).toBe("CLIENTE");
  });

  it("deve marcar user_type como PRESTADOR para usuário com registro em professional", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${professionalToken}`)
      .send(validPayload);

    expect(response.status).toBe(201);

    const ticket = await TicketModel.findByPk(response.body.ticket.id);
    expect(ticket?.user_type).toBe("PRESTADOR");
  });

  it("deve gerar ticket_code único para cada chamado", async () => {
    const response1 = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const response2 = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ ...validPayload, title: "Outro problema" });

    expect(response1.status).toBe(201);
    expect(response2.status).toBe(201);
    expect(response1.body.ticket.ticket_code).not.toBe(
      response2.body.ticket.ticket_code
    );
  });

  it("deve persistir o chamado com status ABERTO por padrão", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${clientToken}`)
      .send(validPayload);

    const ticket = await TicketModel.findByPk(response.body.ticket.id);
    expect(ticket?.status).toBe("ABERTO");
  });
});
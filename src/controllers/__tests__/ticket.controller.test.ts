import { Response } from "express";
import type { AuthenticatedRequest } from "../../interfaces/authentication.interface";
import {
  createTicket,
  listTickets,
  showTicket,
  showTicketMessages,
} from "../ticket.controller";
import * as ticketService from "../../services/ticket/ticket.service";
import logger from "../../utils/logger";

jest.mock("../../config/database", () => ({}));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../services/ticket/ticket.service", () => ({
  isAdmin: jest.fn(),
  resolveUserType: jest.fn(),
  createTicket: jest.fn(),
  listTicketsByUser: jest.fn(),
  findTicketByIdForUser: jest.fn(),
  listMessagesByTicket: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const service = ticketService as jest.Mocked<typeof ticketService>;

const buildResponse = () => {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  return { res: { status: statusMock, json: jsonMock } as Partial<Response>, jsonMock, statusMock };
};

const user = { id: 7, name: "Cliente", email: "cliente@delbicos.local", phone: "11999999999" };

const request = (overrides: Partial<AuthenticatedRequest> = {}) =>
  ({ user, body: {}, params: {}, ...overrides }) as unknown as AuthenticatedRequest;

const createdAt = new Date("2026-11-20T10:00:00.000Z");
const updatedAt = new Date("2026-11-21T09:30:00.000Z");

const ticketRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  ticket_code: "TKT-B7YS",
  title: "Erro ao agendar serviço",
  description: "Não consigo agendar um serviço de limpeza para amanhã.",
  category: "AGENDAMENTO",
  priority: "ALTA",
  status: "ABERTO",
  user_id: 7,
  user_type: "CLIENTE",
  appointment_id: null,
  createdAt,
  updatedAt,
  ...overrides,
});

const body = {
  title: "Erro ao agendar serviço",
  description: "Não consigo agendar um serviço de limpeza para amanhã.",
  category: "AGENDAMENTO",
  priority: "ALTA",
};

beforeEach(() => {
  jest.clearAllMocks();
  service.isAdmin.mockResolvedValue(false);
  service.resolveUserType.mockResolvedValue("CLIENTE");
});

describe("ticket.controller createTicket — POST /api/tickets (TICKET-01 / TICKET-02)", () => {
  it("abre o chamado do cliente e responde 201 em snake_case", async () => {
    service.createTicket.mockResolvedValue(ticketRow() as never);
    const { res, jsonMock, statusMock } = buildResponse();

    await createTicket(request({ body }), res as Response);

    expect(service.createTicket).toHaveBeenCalledWith(body, 7, "CLIENTE");
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      message: "Chamado aberto com sucesso.",
      ticket: {
        id: 42,
        ticket_code: "TKT-B7YS",
        title: body.title,
        category: "AGENDAMENTO",
        priority: "ALTA",
        status: "ABERTO",
        created_at: createdAt,
      },
    });
  });

  it("abre o chamado do prestador com user_type PRESTADOR", async () => {
    service.resolveUserType.mockResolvedValue("PRESTADOR");
    service.createTicket.mockResolvedValue(ticketRow({ user_type: "PRESTADOR" }) as never);
    const { res, statusMock } = buildResponse();

    await createTicket(request({ body }), res as Response);

    expect(service.createTicket).toHaveBeenCalledWith(body, 7, "PRESTADOR");
    expect(statusMock).toHaveBeenCalledWith(201);
  });

  it("bloqueia administrador com 403 sem gravar", async () => {
    service.isAdmin.mockResolvedValue(true);
    const { res, jsonMock, statusMock } = buildResponse();

    await createTicket(request({ body }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Administradores não podem abrir chamados." });
    expect(service.createTicket).not.toHaveBeenCalled();
  });

  it("responde 401 sem usuário autenticado", async () => {
    const { res, statusMock } = buildResponse();

    await createTicket(request({ user: undefined, body }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(service.isAdmin).not.toHaveBeenCalled();
  });

  it("repassa erro 400 do service (agendamento inexistente)", async () => {
    service.createTicket.mockRejectedValue(
      Object.assign(new Error("Agendamento com código NAOEXI não encontrado."), { statusCode: 400 }),
    );
    const { res, jsonMock, statusMock } = buildResponse();

    await createTicket(request({ body }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Agendamento com código NAOEXI não encontrado." });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("responde 500 genérico e registra no logger em erro inesperado", async () => {
    service.createTicket.mockRejectedValue(new Error("conexão perdida"));
    const { res, jsonMock, statusMock } = buildResponse();

    await createTicket(request({ body }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Erro interno ao criar chamado." });
    expect(logger.error).toHaveBeenCalledWith("[createTicket] Erro:", { error: "conexão perdida" });
  });
});

describe("ticket.controller listTickets — GET /api/tickets (TICKET-03)", () => {
  it("lista os chamados do usuário com status e prioridade atuais", async () => {
    service.listTicketsByUser.mockResolvedValue([
      ticketRow({ id: 43, status: "EM_ATENDIMENTO" }),
      ticketRow(),
    ] as never);
    const { res, jsonMock, statusMock } = buildResponse();

    await listTickets(request(), res as Response);

    expect(service.listTicketsByUser).toHaveBeenCalledWith(7);
    expect(statusMock).toHaveBeenCalledWith(200);
    const { tickets } = jsonMock.mock.calls[0][0];
    expect(tickets.map((t: { status: string }) => t.status)).toEqual(["EM_ATENDIMENTO", "ABERTO"]);
    expect(tickets[1]).toEqual({
      id: 42,
      ticket_code: "TKT-B7YS",
      title: "Erro ao agendar serviço",
      category: "AGENDAMENTO",
      priority: "ALTA",
      status: "ABERTO",
      created_at: createdAt,
      updated_at: updatedAt,
    });
  });

  it("responde lista vazia quando não há chamados", async () => {
    service.listTicketsByUser.mockResolvedValue([]);
    const { res, jsonMock } = buildResponse();

    await listTickets(request(), res as Response);

    expect(jsonMock).toHaveBeenCalledWith({ tickets: [] });
  });

  it("responde 401 sem usuário e 500 em erro inesperado", async () => {
    const unauth = buildResponse();
    await listTickets(request({ user: undefined }), unauth.res as Response);
    expect(unauth.statusMock).toHaveBeenCalledWith(401);

    service.listTicketsByUser.mockRejectedValue(new Error("falha"));
    const failure = buildResponse();
    await listTickets(request(), failure.res as Response);
    expect(failure.statusMock).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ticket.controller showTicket — GET /api/tickets/:id (TICKET-03)", () => {
  it("devolve o detalhe do próprio chamado", async () => {
    service.findTicketByIdForUser.mockResolvedValue(ticketRow({ appointment_id: 31 }) as never);
    const { res, jsonMock, statusMock } = buildResponse();

    await showTicket(request({ params: { id: "42" } }), res as Response);

    expect(service.findTicketByIdForUser).toHaveBeenCalledWith(42, 7);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock.mock.calls[0][0].ticket).toMatchObject({
      id: 42,
      description: "Não consigo agendar um serviço de limpeza para amanhã.",
      priority: "ALTA",
      status: "ABERTO",
      user_type: "CLIENTE",
      appointment_id: 31,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  });

  it("responde 404 para chamado inexistente ou de outro usuário", async () => {
    service.findTicketByIdForUser.mockResolvedValue(null);
    const { res, jsonMock, statusMock } = buildResponse();

    await showTicket(request({ params: { id: "42" } }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Chamado não encontrado." });
  });

  it.each(["abc", "1.5", "0", "-3", ""])("responde 400 para ID inválido (%p) sem consultar o banco", async (id) => {
    const { res, statusMock } = buildResponse();

    await showTicket(request({ params: { id } }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(service.findTicketByIdForUser).not.toHaveBeenCalled();
  });
});

describe("ticket.controller showTicketMessages — GET /api/tickets/:id/messages", () => {
  it("devolve o histórico com os dados do autor", async () => {
    service.listMessagesByTicket.mockResolvedValue([
      {
        id: 1,
        ticket_id: 42,
        author_id: 7,
        author_type: "CLIENTE",
        content: "Primeira mensagem",
        attachment_url: null,
        createdAt,
        author: { name: "Cliente", avatar_uri: "https://cdn/avatar.jpg" },
      },
      {
        id: 2,
        ticket_id: 42,
        author_id: 3,
        author_type: "ADMIN",
        content: "Resposta",
        attachment_url: null,
        createdAt: updatedAt,
      },
    ] as never);
    const { res, jsonMock, statusMock } = buildResponse();

    await showTicketMessages(request({ params: { id: "42" } }), res as Response);

    expect(service.listMessagesByTicket).toHaveBeenCalledWith(42, 7);
    expect(statusMock).toHaveBeenCalledWith(200);
    const { messages } = jsonMock.mock.calls[0][0];
    expect(messages[0].author).toEqual({ id: 7, type: "CLIENTE", name: "Cliente", avatar_uri: "https://cdn/avatar.jpg" });
    // autor sem dados carregados cai no fallback
    expect(messages[1].author).toEqual({ id: 3, type: "ADMIN", name: "Usuário", avatar_uri: null });
  });

  it("responde 404 quando o chamado não é do usuário", async () => {
    service.listMessagesByTicket.mockResolvedValue(null);
    const { res, statusMock } = buildResponse();

    await showTicketMessages(request({ params: { id: "42" } }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
  });

  it("responde 400 para ID inválido", async () => {
    const { res, statusMock } = buildResponse();

    await showTicketMessages(request({ params: { id: "abc" } }), res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(service.listMessagesByTicket).not.toHaveBeenCalled();
  });
});

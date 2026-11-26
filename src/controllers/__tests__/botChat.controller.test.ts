jest.mock("../../config/database");
jest.mock("../../services/botConversation.service", () => ({
  processMessage: jest.fn(),
  getSessionHistory: jest.fn(),
  getActiveSessionHistory: jest.fn(),
}));
jest.mock("../../models/Appointment", () => ({ AppointmentModel: { findOne: jest.fn() } }));
jest.mock("../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import {
  getActiveSessionHistory,
  getSessionHistory,
  processMessage,
} from "../../services/botConversation.service";
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { logError } from "../../utils/logger";
import {
  getActiveBotSession,
  getBotAppointmentStatus,
  getBotSession,
  sendBotMessage,
} from "../botChat.controller";
import { mockReq, mockRes, type MockResponse } from "./handlerTestUtils";

const user = { id: 5 };
const withHeader = (res: MockResponse) => {
  const typed = res as MockResponse & { setHeader: jest.Mock };
  typed.setHeader = jest.fn();
  return typed;
};

beforeEach(() => jest.clearAllMocks());

describe("sendBotMessage", () => {
  const send = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const res = mockRes();
    return sendBotMessage(mockReq({ user, body, authSessionId: "auth-1", ...extra }), res).then(
      () => res,
    );
  };

  it("exige usuário autenticado (401)", async () => {
    const res = mockRes();
    await sendBotMessage(mockReq({ body: { message: "oi" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it.each([[undefined], [123], ["   "]])("recusa mensagem ausente ou vazia (%p)", async (message) => {
    const res = await send({ message });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "O campo 'message' é obrigatório e não pode estar vazio",
    });
  });

  it("recusa mensagem só com caracteres de controle", async () => {
    const res = await send({ message: "\u0000\u0007" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Mensagem contém apenas caracteres inválidos" });
  });

  it("recusa mensagem acima de 2000 caracteres", async () => {
    const res = await send({ message: "a".repeat(2001) });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Mensagem muito longa (máx. 2000 caracteres)" });
  });

  it.each([["abc"], [0], [-3]])("recusa session_id inválido (%p)", async (session_id) => {
    const res = await send({ message: "oi", session_id });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "session_id inválido" });
  });

  it("processa a mensagem limpa e devolve a resposta do bot", async () => {
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 9,
      message: "Olá!",
      state: "INICIO",
      context: { a: 1 },
      clearHistory: true,
    });

    const res = await send({
      message: " oi\u0000 tudo\tbem \n",
      session_id: "9",
      channel: "c".repeat(60),
      selected_time: " 2030-01-01T10:00:00-03:00 ",
      timezone: "America/Sao_Paulo",
    });

    expect(processMessage).toHaveBeenCalledWith(
      5,
      "auth-1",
      "oi tudo\tbem",
      9,
      "c".repeat(50),
      "2030-01-01T10:00:00-03:00",
      "America/Sao_Paulo",
    );
    expect(res.json).toHaveBeenCalledWith({
      session_id: 9,
      message: "Olá!",
      state: "INICIO",
      context: { a: 1 },
      clear_history: true,
    });
  });

  it("usa canal web e ignora horário e fuso que não são texto", async () => {
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 1,
      message: "ok",
      state: "INICIO",
      context: {},
    });

    const res = await send({ message: "oi", channel: 3, selected_time: "  ", timezone: 1 });

    expect(processMessage).toHaveBeenCalledWith(5, "auth-1", "oi", undefined, "web", undefined, undefined);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ clear_history: false }));
  });

  it("responde 404 quando a sessão não é encontrada", async () => {
    (processMessage as jest.Mock).mockRejectedValue(new Error("Sessão não encontrada"));

    const res = await send({ message: "oi", session_id: 4 });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Sessão não encontrada" });
    expect(logError).toHaveBeenCalledWith(
      "Bot: erro ao processar mensagem",
      expect.any(Error),
      { userId: 5, sessionId: 4 },
    );
  });

  it("responde 500 para erro inesperado", async () => {
    (processMessage as jest.Mock).mockRejectedValue(new Error("falhou"));

    const res = await send({ message: "oi" });

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno ao processar mensagem" });
  });
});

describe("getBotSession", () => {
  it("exige usuário autenticado (401)", async () => {
    const res = mockRes();
    await getBotSession(mockReq({ params: { id: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it.each([["abc"], ["0"], ["1.5"]])("recusa id inválido (%p)", async (id) => {
    const res = mockRes();
    await getBotSession(mockReq({ user, params: { id } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID de sessão inválido" });
  });

  it("devolve o histórico sem cache", async () => {
    const history = { session: { id: 3 }, messages: [] };
    (getSessionHistory as jest.Mock).mockResolvedValue(history);
    const res = withHeader(mockRes());

    await getBotSession(mockReq({ user, params: { id: "3" } }), res);

    expect(getSessionHistory).toHaveBeenCalledWith(3, 5);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith(history);
  });

  it("responde 404 quando o erro diz que a sessão não foi encontrada", async () => {
    (getSessionHistory as jest.Mock).mockRejectedValue(new Error("Sessão não encontrada"));
    const res = withHeader(mockRes());

    await getBotSession(mockReq({ user, params: { id: "3" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("responde 500 para o histórico inexistente do serviço (mensagem no masculino)", async () => {
    // Comportamento atual: o serviço lança "Histórico de sessão não encontrado",
    // que não contém "não encontrada"; por isso cai no 500.
    (getSessionHistory as jest.Mock).mockRejectedValue(
      new Error("Histórico de sessão não encontrado ou não pertence a este usuário"),
    );
    const res = withHeader(mockRes());

    await getBotSession(mockReq({ user, params: { id: "3" } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno ao buscar sessão" });
  });
});

describe("getActiveBotSession", () => {
  it("exige usuário autenticado (401)", async () => {
    const res = mockRes();
    await getActiveBotSession(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("devolve a sessão ativa sem cache", async () => {
    (getActiveSessionHistory as jest.Mock).mockResolvedValue(null);
    const res = withHeader(mockRes());

    await getActiveBotSession(mockReq({ user }), res);

    expect(getActiveSessionHistory).toHaveBeenCalledWith(5);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith(null);
  });

  it("responde 500 quando a busca falha", async () => {
    (getActiveSessionHistory as jest.Mock).mockRejectedValue(new Error("db"));
    const res = withHeader(mockRes());

    await getActiveBotSession(mockReq({ user }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno ao buscar sessão ativa" });
  });
});

describe("getBotAppointmentStatus", () => {
  const updatedAt = new Date("2030-01-01T10:00:00Z");
  const call = async (id = "7") => {
    const res = withHeader(mockRes());
    await getBotAppointmentStatus(mockReq({ user, params: { id } }), res);
    return res;
  };

  it("exige usuário autenticado (401)", async () => {
    const res = mockRes();
    await getBotAppointmentStatus(mockReq({ params: { id: "7" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("recusa id inválido (400)", async () => {
    const res = await call("x");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID de agendamento inválido" });
  });

  it("responde 404 quando o usuário não é cliente", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);

    const res = await call();

    expect(AppointmentModel.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("responde 404 quando o agendamento não é do cliente", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);

    const res = await call();

    expect(AppointmentModel.findOne).toHaveBeenCalledWith({
      where: { id: 7, client_id: 2 },
      attributes: ["id", "status", "payment_intent_id", "updatedAt"],
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Agendamento não encontrado" });
  });

  it("pede nova consulta em 5s enquanto aguarda o profissional", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 7,
      status: "pending",
      payment_intent_id: null,
      updatedAt,
    });

    const res = await call();

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "5");
    expect(res.json).toHaveBeenCalledWith({
      appointment_id: 7,
      status: "pending",
      message: "O agendamento continua pendente de resposta do profissional.",
      waiting_for_professional: true,
      payment_status: "not_available",
      payment_pending: false,
      paid: false,
      poll_after_ms: 5000,
      updated_at: updatedAt,
    });
  });

  it("pede nova consulta em 10s quando confirmado e não pago", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 7,
      status: "confirmed",
      payment_intent_id: null,
      updatedAt,
    });

    const res = await call();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "pending", payment_pending: true, poll_after_ms: 10000 }),
    );
  });

  it("não pede nova consulta quando já está pago", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 7,
      status: "confirmed",
      payment_intent_id: "pi_1",
      updatedAt,
    });

    const res = await call();

    expect(res.setHeader).not.toHaveBeenCalledWith("Retry-After", "5");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ paid: true, payment_status: "paid", poll_after_ms: null }),
    );
  });
});

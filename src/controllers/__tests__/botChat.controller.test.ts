jest.mock("../../models/Appointment", () => ({
  AppointmentModel: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../models/Client", () => ({
  ClientModel: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../services/botConversation.service", () => ({
  processMessage: jest.fn(),
  getSessionHistory: jest.fn(),
  getActiveSessionHistory: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logError: jest.fn(),
}));

import { sendBotMessage } from "../botChat.controller";
import { processMessage } from "../../services/botConversation.service";
import { botMessageIdempotencyStore } from "../../services/botMessageIdempotency.service";

function createResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

describe("botChat.controller - sendBotMessage (Idempotência)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    botMessageIdempotencyStore.clear();
  });

  it("retorna 401 se o usuário não estiver autenticado", async () => {
    const req: any = { user: undefined, body: { message: "Olá" } };
    const res = createResponse();

    await sendBotMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
  });

  it("retorna 400 quando o Idempotency-Key for inválido", async () => {
    const req: any = {
      user: { id: 10 },
      body: { message: "Quero agendar" },
      header: jest.fn((name: string) => {
        if (name === "idempotency-key") return "curta";
        return undefined;
      }),
    };
    const res = createResponse();

    await sendBotMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Idempotency-Key inválido; use de 8 a 128 caracteres seguros",
    });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("processa mensagem normalmente com chave de idempotência válida", async () => {
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 101,
      message: "Qual serviço você deseja?",
      state: "COLETANDO_SERVICO",
      context: {},
      clearHistory: false,
    });

    const req: any = {
      user: { id: 10 },
      authSessionId: "session-abc",
      body: { message: "Olá, assistente" },
      header: jest.fn((name: string) => {
        if (name === "idempotency-key") return "idempotency-key-001";
        return undefined;
      }),
    };
    const res = createResponse();

    await sendBotMessage(req, res);

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      session_id: 101,
      message: "Qual serviço você deseja?",
      state: "COLETANDO_SERVICO",
      context: {},
      clear_history: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).not.toHaveBeenCalledWith("Idempotency-Replayed", "true");
  });

  it("reutiliza a mesma resposta e não duplica ação quando reenvio possui a mesma chave no header", async () => {
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 101,
      message: "Agendamento confirmado com sucesso!",
      state: "FINALIZADO",
      context: { appointmentId: 99 },
      clearHistory: false,
    });

    const makeRequest = () => ({
      user: { id: 10 },
      authSessionId: "session-abc",
      body: { message: "Sim, confirmo" },
      header: jest.fn((name: string) => {
        if (name === "idempotency-key") return "confirm-booking-key-123";
        return undefined;
      }),
    });

    const firstRes = createResponse();
    await sendBotMessage(makeRequest() as any, firstRes);

    const replayRes = createResponse();
    await sendBotMessage(makeRequest() as any, replayRes);

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(replayRes.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    expect(replayRes.json).toHaveBeenCalledWith(firstRes.json.mock.calls[0][0]);
  });

  it("reutiliza a resposta quando a chave é enviada no body idempotency_key", async () => {
    (processMessage as jest.Mock).mockResolvedValue({
      sessionId: 202,
      message: "Serviço cancelado com sucesso.",
      state: "INICIO",
      context: {},
      clearHistory: false,
    });

    const makeRequest = () => ({
      user: { id: 10 },
      authSessionId: "session-abc",
      body: {
        message: "Cancelar agendamento",
        idempotency_key: "cancel-booking-key-999",
      },
      header: jest.fn(() => undefined),
    });

    const firstRes = createResponse();
    await sendBotMessage(makeRequest() as any, firstRes);

    const replayRes = createResponse();
    await sendBotMessage(makeRequest() as any, replayRes);

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(replayRes.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    expect(replayRes.json).toHaveBeenCalledWith({
      session_id: 202,
      message: "Serviço cancelado com sucesso.",
      state: "INICIO",
      context: {},
      clear_history: false,
    });
  });
});

import type { Server as HttpServer } from "http";

type Handler = (...args: unknown[]) => unknown;
type Middleware = (socket: FakeSocket, next: (err?: Error) => void) => void;

interface FakeSocket {
  id: string;
  userId?: number;
  handshake: {
    auth?: { token?: string };
    headers?: { authorization?: string };
  };
  handlers: Record<string, Handler>;
  on: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
}

const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
const mockServerState: {
  middleware?: Middleware;
  onConnection?: (socket: FakeSocket) => void;
  options?: unknown;
} = {};

jest.mock("socket.io", () => ({
  Server: jest.fn().mockImplementation((_http: unknown, options: unknown) => {
    mockServerState.options = options;
    return {
      use: (fn: Middleware) => {
        mockServerState.middleware = fn;
      },
      on: (event: string, fn: (socket: FakeSocket) => void) => {
        if (event === "connection") mockServerState.onConnection = fn;
      },
      to: mockTo,
    };
  }),
}));

jest.mock("../../config/database");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));
jest.mock("../../utils/jwt.util", () => ({ verifyToken: jest.fn() }));
jest.mock("../locationTracking", () => ({ registerLocationTracking: jest.fn() }));
jest.mock("../../services/chat.service", () => {
  class ChatMongoUnavailableError extends Error {
    constructor() {
      super("MongoDB do chat indisponível");
      this.name = "ChatMongoUnavailableError";
    }
  }
  return {
    ChatMongoUnavailableError,
    assertParticipant: jest.fn(),
    persistMessage: jest.fn(),
  };
});

import {
  assertParticipant,
  ChatMongoUnavailableError,
  persistMessage,
} from "../../services/chat.service";
import { verifyToken } from "../../utils/jwt.util";
import logger from "../../utils/logger";
import { registerLocationTracking } from "../locationTracking";
import {
  AppointmentStatusSocketPayload,
  emitAppointmentStatusUpdate,
  getChatSocket,
  initChatSocket,
} from "../chatSocket";

const mockedAssertParticipant = assertParticipant as jest.Mock;
const mockedPersistMessage = persistMessage as jest.Mock;
const mockedVerifyToken = verifyToken as jest.Mock;

const fakeHttpServer = {} as unknown as HttpServer;

function createSocket(overrides: Partial<FakeSocket> = {}): FakeSocket {
  const handlers: Record<string, Handler> = {};
  return {
    id: "socket-1",
    handshake: {},
    handlers,
    on: jest.fn((event: string, fn: Handler) => {
      handlers[event] = fn;
    }),
    join: jest.fn(),
    leave: jest.fn(),
    ...overrides,
  };
}

function connect(userId?: number): FakeSocket {
  const socket = createSocket({ userId });
  mockServerState.onConnection?.(socket);
  return socket;
}

function runMiddleware(socket: FakeSocket): Error | undefined {
  let result: Error | undefined;
  let called = false;
  mockServerState.middleware?.(socket, (err?: Error) => {
    called = true;
    result = err;
  });
  expect(called).toBe(true);
  return result;
}

const statusPayload: AppointmentStatusSocketPayload = {
  appointment_id: 10,
  status: "confirmed",
  session_ids: [1],
  message: "Agendamento confirmado",
  payment_status: "pending",
  payment_pending: true,
  paid: false,
  updated_at: "2026-11-26T10:00:00.000Z",
};

const originalOrigins = process.env.ALLOWED_ORIGINS;

afterAll(() => {
  if (originalOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = originalOrigins;
});

describe("chatSocket antes da inicialização", () => {
  it("não tem servidor e ignora o envio de status de agendamento", () => {
    expect(getChatSocket()).toBeNull();
    emitAppointmentStatusUpdate(5, statusPayload);
    expect(mockTo).not.toHaveBeenCalled();
  });
});

describe("initChatSocket", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it("aceita qualquer origem quando ALLOWED_ORIGINS não está definida", () => {
    const io = initChatSocket(fakeHttpServer);
    expect(getChatSocket()).toBe(io);
    expect(mockServerState.options).toEqual({
      cors: { origin: true, methods: ["GET", "POST"], credentials: true },
    });
  });

  it("restringe o CORS às origens configuradas", () => {
    process.env.ALLOWED_ORIGINS = " https://a.com , ,https://b.com";
    initChatSocket(fakeHttpServer);
    expect(mockServerState.options).toMatchObject({
      cors: { origin: ["https://a.com", "https://b.com"] },
    });
  });

  it("envia o status do agendamento para o canal do usuário", () => {
    initChatSocket(fakeHttpServer);
    emitAppointmentStatusUpdate(5, statusPayload);
    expect(mockTo).toHaveBeenCalledWith("user:5");
    expect(mockEmit).toHaveBeenCalledWith("appointment:status", statusPayload);
  });
});

describe("autenticação no handshake", () => {
  beforeEach(() => {
    initChatSocket(fakeHttpServer);
  });

  it("recusa conexão sem token", () => {
    const err = runMiddleware(createSocket());
    expect(err?.message).toBe("Token JWT ausente");
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("autentica pelo token do campo auth", () => {
    mockedVerifyToken.mockReturnValue({ user: { id: 42 } });
    const socket = createSocket({ handshake: { auth: { token: "abc" } } });
    expect(runMiddleware(socket)).toBeUndefined();
    expect(mockedVerifyToken).toHaveBeenCalledWith("abc");
    expect(socket.userId).toBe(42);
  });

  it("autentica pelo cabeçalho Authorization com Bearer", () => {
    mockedVerifyToken.mockReturnValue({ user: { id: 7 } });
    const socket = createSocket({
      handshake: { headers: { authorization: "Bearer xyz" } },
    });
    expect(runMiddleware(socket)).toBeUndefined();
    expect(mockedVerifyToken).toHaveBeenCalledWith("xyz");
    expect(socket.userId).toBe(7);
  });

  it("recusa token inválido", () => {
    mockedVerifyToken.mockImplementation(() => {
      throw new Error("jwt malformed");
    });
    const socket = createSocket({ handshake: { auth: { token: "ruim" } } });
    expect(runMiddleware(socket)?.message).toBe("Token inválido");
    expect(socket.userId).toBeUndefined();
  });
});

describe("conexão", () => {
  beforeEach(() => {
    initChatSocket(fakeHttpServer);
  });

  it("entra no canal do usuário e registra o rastreamento", () => {
    const socket = connect(3);
    expect(socket.join).toHaveBeenCalledWith("user:3");
    expect(registerLocationTracking).toHaveBeenCalledWith(
      getChatSocket(),
      socket,
    );
    expect(Object.keys(socket.handlers)).toEqual(
      expect.arrayContaining([
        "room:join",
        "room:leave",
        "message:send",
        "disconnect",
      ]),
    );
  });

  it("não entra em canal de usuário quando o socket não tem userId", () => {
    const socket = connect();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("registra no log a desconexão", () => {
    const socket = connect(3);
    socket.handlers.disconnect();
    expect(logger.info).toHaveBeenCalledWith("Socket desconectado", {
      userId: 3,
      id: "socket-1",
    });
  });
});

describe("room:join", () => {
  beforeEach(() => {
    initChatSocket(fakeHttpServer);
  });

  it("recusa usuário não autenticado", async () => {
    const socket = connect();
    const ack = jest.fn();
    await socket.handlers["room:join"](1, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Não autenticado" });
    expect(mockedAssertParticipant).not.toHaveBeenCalled();
  });

  it("recusa quem não participa da conversa", async () => {
    mockedAssertParticipant.mockResolvedValue(null);
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["room:join"]("9", ack);
    expect(mockedAssertParticipant).toHaveBeenCalledWith(9, 3);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Você não participa desta conversa",
    });
    expect(socket.join).not.toHaveBeenCalledWith("room:9");
  });

  it("entra na sala e devolve papel e status", async () => {
    mockedAssertParticipant.mockResolvedValue({
      role: "client",
      room: { status: "active" },
    });
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["room:join"](9, ack);
    expect(socket.join).toHaveBeenCalledWith("room:9");
    expect(ack).toHaveBeenCalledWith({
      ok: true,
      role: "client",
      status: "active",
    });
  });

  it("funciona sem callback de ack", async () => {
    mockedAssertParticipant.mockResolvedValue({
      role: "professional",
      room: { status: "active" },
    });
    const socket = connect(3);
    await expect(socket.handlers["room:join"](9)).resolves.toBeUndefined();
    expect(socket.join).toHaveBeenCalledWith("room:9");
  });

  it("responde erro genérico quando a validação falha", async () => {
    mockedAssertParticipant.mockRejectedValue(new Error("db fora"));
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["room:join"](9, ack);
    expect(logger.error).toHaveBeenCalledWith(
      "Erro em room:join",
      expect.any(Object),
    );
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Erro ao entrar na sala",
    });
  });
});

describe("room:leave", () => {
  it("sai do canal da sala", () => {
    initChatSocket(fakeHttpServer);
    const socket = connect(3);
    socket.handlers["room:leave"]("9");
    expect(socket.leave).toHaveBeenCalledWith("room:9");
  });
});

describe("message:send", () => {
  const activeParticipant = { role: "client", room: { status: "active" } };
  const message = { id: "m1", room_id: 9, text: "oi" };

  beforeEach(() => {
    initChatSocket(fakeHttpServer);
  });

  it("recusa usuário não autenticado", async () => {
    const socket = connect();
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Não autenticado" });
  });

  it.each([
    ["payload ausente", undefined],
    ["sala ausente", { clientMessageUuid: "u1", text: "oi" }],
    ["uuid ausente", { roomId: 9, text: "oi" }],
    ["texto em branco", { roomId: 9, clientMessageUuid: "u1", text: "   " }],
  ])("recusa payload inválido (%s)", async (_label, payload) => {
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](payload, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Payload inválido" });
    expect(mockedAssertParticipant).not.toHaveBeenCalled();
  });

  it("recusa quem não participa da conversa", async () => {
    mockedAssertParticipant.mockResolvedValue(null);
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: "9", clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(mockedAssertParticipant).toHaveBeenCalledWith(9, 3);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Você não participa desta conversa",
    });
  });

  it("recusa mensagens em sala arquivada", async () => {
    mockedAssertParticipant.mockResolvedValue({
      role: "client",
      room: { status: "archived" },
    });
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Esta conversa está arquivada e não aceita novas mensagens",
    });
    expect(mockedPersistMessage).not.toHaveBeenCalled();
  });

  it("persiste, emite message:new na sala e confirma no ack", async () => {
    mockedAssertParticipant.mockResolvedValue(activeParticipant);
    mockedPersistMessage.mockResolvedValue({ message, isNew: true });
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      {
        roomId: 9,
        clientMessageUuid: "u1",
        text: "  oi  ",
        sentAt: "2026-11-26T10:00:00.000Z",
      },
      ack,
    );
    expect(mockedPersistMessage).toHaveBeenCalledWith({
      roomId: 9,
      clientMessageUuid: "u1",
      senderUserId: 3,
      senderRole: "client",
      text: "oi",
      sentAt: new Date("2026-11-26T10:00:00.000Z"),
    });
    expect(mockTo).toHaveBeenCalledWith("room:9");
    expect(mockEmit).toHaveBeenCalledWith("message:new", message);
    expect(ack).toHaveBeenCalledWith({ ok: true, message, duplicated: false });
  });

  it("marca reenvio como duplicado e usa a hora atual sem sentAt", async () => {
    mockedAssertParticipant.mockResolvedValue(activeParticipant);
    mockedPersistMessage.mockResolvedValue({ message, isNew: false });
    const socket = connect(3);
    const ack = jest.fn();
    const before = Date.now();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    const sentAt = mockedPersistMessage.mock.calls[0][0].sentAt as Date;
    expect(sentAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(ack).toHaveBeenCalledWith({ ok: true, message, duplicated: true });
  });

  it("troca sentAt inválido pela hora atual", async () => {
    mockedAssertParticipant.mockResolvedValue(activeParticipant);
    mockedPersistMessage.mockResolvedValue({ message, isNew: true });
    const socket = connect(3);
    await socket.handlers["message:send"]({
      roomId: 9,
      clientMessageUuid: "u1",
      text: "oi",
      sentAt: "data-invalida",
    });
    const sentAt = mockedPersistMessage.mock.calls[0][0].sentAt as Date;
    expect(Number.isNaN(sentAt.getTime())).toBe(false);
  });

  it("devolve a mensagem do erro de MongoDB indisponível", async () => {
    mockedAssertParticipant.mockResolvedValue(activeParticipant);
    mockedPersistMessage.mockRejectedValue(new ChatMongoUnavailableError());
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "MongoDB do chat indisponível",
    });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("devolve a mensagem de um erro comum", async () => {
    mockedAssertParticipant.mockRejectedValue(new Error("falhou"));
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Erro em message:send",
      expect.objectContaining({ message: "falhou" }),
    );
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "falhou" });
  });

  it("usa mensagem padrão quando o erro não é um Error", async () => {
    mockedAssertParticipant.mockRejectedValue("falha estranha");
    const socket = connect(3);
    const ack = jest.fn();
    await socket.handlers["message:send"](
      { roomId: 9, clientMessageUuid: "u1", text: "oi" },
      ack,
    );
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Erro ao enviar mensagem",
    });
  });
});

jest.mock("../../services/chat.service", () => {
  class ChatMongoUnavailableError extends Error {
    constructor() {
      super("MongoDB do chat indisponível");
      this.name = "ChatMongoUnavailableError";
    }
  }
  return {
    ChatMongoUnavailableError,
    listRooms: jest.fn(),
    getMessages: jest.fn(),
    assertParticipant: jest.fn(),
  };
});

import {
  assertParticipant,
  ChatMongoUnavailableError,
  getMessages,
  listRooms,
} from "../../services/chat.service";
import { getChatMessages, getChatRooms } from "../chat.controller";
import { mockReq, mockRes } from "./handlerTestUtils";

describe("chat.controller", () => {
  it("exige usuario autenticado para listar as salas (401)", async () => {
    const res = mockRes();
    await getChatRooms(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
  });

  it("devolve as salas do usuario autenticado", async () => {
    (listRooms as jest.Mock).mockResolvedValue([{ room_id: 1 }]);
    const res = mockRes();
    await getChatRooms(mockReq({ user: { id: 4 } }), res);
    expect(res.json).toHaveBeenCalledWith([{ room_id: 1 }]);
  });

  it("responde 500 quando a listagem de salas falha", async () => {
    (listRooms as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getChatRooms(mockReq({ user: { id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("responde 400 para id de sala nao numerico", async () => {
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "abc" }, query: {} }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID da sala inválido" });
  });

  it("responde 403 para quem nao participa da sala", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Você não participa desta conversa",
    });
  });

  it("devolve o historico para quem participa", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue({
      role: "client",
      room: { status: "active" },
    });
    (getMessages as jest.Mock).mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }),
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      messages: [],
      nextCursor: null,
      room_status: "active",
      role: "client",
    });
  });

  it("responde 503 quando o Mongo do chat esta indisponivel", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue({
      role: "client",
      room: { status: "active" },
    });
    (getMessages as jest.Mock).mockRejectedValue(
      new ChatMongoUnavailableError(),
    );
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

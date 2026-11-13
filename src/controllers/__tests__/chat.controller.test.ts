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
import { mockReq, mockRes } from "../../test/http";

describe("chat.controller", () => {
  it("returns 401 when listing rooms without a user", async () => {
    const res = mockRes();
    await getChatRooms(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
  });

  it("returns the rooms of the authenticated user", async () => {
    (listRooms as jest.Mock).mockResolvedValue([{ room_id: 1 }]);
    const res = mockRes();
    await getChatRooms(mockReq({ user: { id: 4 } }) as any, res);
    expect(res.json).toHaveBeenCalledWith([{ room_id: 1 }]);
  });

  it("returns 500 when listing rooms fails", async () => {
    (listRooms as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getChatRooms(mockReq({ user: { id: 4 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 400 for a non-numeric room id", async () => {
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "abc" }, query: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID da sala inválido" });
  });

  it("returns 403 when the user is not a participant", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Você não participa desta conversa",
    });
  });

  it("returns history for a participant", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue({
      role: "client",
      room: { status: "active" },
    });
    (getMessages as jest.Mock).mockResolvedValue({ messages: [], nextCursor: null });
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }) as any,
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      messages: [],
      nextCursor: null,
      room_status: "active",
      role: "client",
    });
  });

  it("returns 503 when chat mongo is unavailable", async () => {
    (assertParticipant as jest.Mock).mockResolvedValue({
      role: "client",
      room: { status: "active" },
    });
    (getMessages as jest.Mock).mockRejectedValue(new ChatMongoUnavailableError());
    const res = mockRes();
    await getChatMessages(
      mockReq({ user: { id: 4 }, params: { roomId: "3" }, query: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

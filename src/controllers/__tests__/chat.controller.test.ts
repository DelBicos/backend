import { Response } from "express";
import { AuthenticatedRequest } from "../../interfaces/authentication.interface";
import { getChatMessages, getChatRooms } from "../chat.controller";
import {
  assertParticipant,
  ChatMongoUnavailableError,
  getMessages,
  listRooms,
} from "../../services/chat.service";

jest.mock("../../services/chat.service", () => {
  class ChatMongoUnavailableError extends Error {
    constructor() {
      super("Chat indisponível");
    }
  }
  return {
    assertParticipant: jest.fn(),
    getMessages: jest.fn(),
    listRooms: jest.fn(),
    ChatMongoUnavailableError,
  };
});
jest.mock("../../utils/logger", () => ({ logError: jest.fn() }));

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const req = (overrides: Record<string, unknown> = {}) =>
  ({ user: { id: 1 }, params: {}, query: {}, ...overrides }) as unknown as AuthenticatedRequest;

const asRes = (res: ReturnType<typeof buildResponse>) => res as unknown as Response;

describe("chat.controller", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getChatRooms", () => {
    it("CHT-01: sem usuário retorna 401", async () => {
      const res = buildResponse();
      await getChatRooms(req({ user: undefined }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it.each([
      ["5", 5],
      ["abc", undefined],
      [undefined, undefined],
    ])("CHT-02: limit %p vira %p", async (limit, expected) => {
      (listRooms as jest.Mock).mockResolvedValue([{ id: 1 }]);
      const res = buildResponse();
      await getChatRooms(req({ query: { limit } }), asRes(res));
      expect(listRooms).toHaveBeenCalledWith(1, { limit: expected });
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it("CHT-03: erro retorna 500", async () => {
      (listRooms as jest.Mock).mockRejectedValue(new Error("db"));
      const res = buildResponse();
      await getChatRooms(req(), asRes(res));
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("getChatMessages", () => {
    const participant = { role: "client", room: { status: "open" } };

    it("CHT-04: sem usuário retorna 401", async () => {
      const res = buildResponse();
      await getChatMessages(req({ user: undefined }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("CHT-05: roomId inválido retorna 400", async () => {
      const res = buildResponse();
      await getChatMessages(req({ params: { roomId: "x" } }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("CHT-06: quem não participa recebe 403", async () => {
      (assertParticipant as jest.Mock).mockResolvedValue(null);
      const res = buildResponse();
      await getChatMessages(req({ params: { roomId: "3" } }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(403);
      expect(getMessages).not.toHaveBeenCalled();
    });

    it.each([
      [undefined, 20],
      ["0", 20],
      ["1", 1],
      ["50", 50],
      ["51", 20],
    ])("CHT-07: limit %p (valor-limite) vira %p", async (limit, expected) => {
      (assertParticipant as jest.Mock).mockResolvedValue(participant);
      (getMessages as jest.Mock).mockResolvedValue({ messages: [], next_cursor: null });
      const res = buildResponse();
      await getChatMessages(
        req({ params: { roomId: "3" }, query: { limit, cursor: "2026-01-01T00:00:00Z" } }),
        asRes(res),
      );
      expect(getMessages).toHaveBeenCalledWith(3, "2026-01-01T00:00:00Z", expected);
      expect(res.json).toHaveBeenCalledWith({
        messages: [],
        next_cursor: null,
        room_status: "open",
        role: "client",
      });
    });

    it("CHT-08: Mongo indisponível retorna 503", async () => {
      (assertParticipant as jest.Mock).mockRejectedValue(new ChatMongoUnavailableError());
      const res = buildResponse();
      await getChatMessages(req({ params: { roomId: "3" } }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ error: "Chat indisponível" });
    });

    it("CHT-09: erro inesperado retorna 500", async () => {
      (assertParticipant as jest.Mock).mockRejectedValue(new Error("db"));
      const res = buildResponse();
      await getChatMessages(req({ params: { roomId: "3" } }), asRes(res));
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

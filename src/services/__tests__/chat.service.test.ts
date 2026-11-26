const mockLean = jest.fn();
const mockLimit = jest.fn(() => ({ lean: mockLean }));
const mockSort = jest.fn(() => ({ limit: mockLimit }));
const mockFind = jest.fn(() => ({ sort: mockSort }));
const mockFindOneLean = jest.fn();
const mockFindOne = jest.fn(() => ({ lean: mockFindOneLean }));
const mockCreate = jest.fn();

jest.mock("../../models/ChatMessage", () => ({
  ChatMessage: { find: mockFind, findOne: mockFindOne, create: mockCreate },
}));
jest.mock("../../config/database");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));
jest.mock("../../models/ChatRoom", () => ({
  ChatRoomModel: { findByPk: jest.fn(), findAll: jest.fn(), update: jest.fn() },
}));
jest.mock("../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn() },
}));
jest.mock("../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../utils/chatRoom", () => ({ syncChatRoomsForUser: jest.fn() }));

import { Op } from "sequelize";
import { isChatMongoReady } from "../../config/database";
import { ChatRoomModel } from "../../models/ChatRoom";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { syncChatRoomsForUser } from "../../utils/chatRoom";
import logger from "../../utils/logger";
import {
  assertParticipant,
  ChatMongoUnavailableError,
  getMessages,
  listRooms,
  persistMessage,
  resolveParticipant,
} from "../chat.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const doc = (id: string, sentAt: string) => ({
  _id: id,
  room_id: 7,
  client_message_uuid: `uuid-${id}`,
  sender_user_id: 1,
  sender_role: "client" as const,
  text: `msg ${id}`,
  sent_at: new Date(sentAt),
  created_at: new Date(sentAt),
});

function mockProfiles(clientId: number | null, professionalId: number | null) {
  mocked(ClientModel.findOne).mockResolvedValue(
    clientId === null ? null : { id: clientId },
  );
  mocked(ProfessionalModel.findOne).mockResolvedValue(
    professionalId === null ? null : { id: professionalId },
  );
}

/** Espera as promessas pendentes (sync em background) terminarem. */
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mocked(isChatMongoReady).mockReturnValue(true);
  mocked(syncChatRoomsForUser).mockResolvedValue(undefined);
});

describe("chat.service getMessages", () => {
  it("ordena o histórico por um único campo (compatível com o Cosmos DB)", async () => {
    mockLean.mockResolvedValue([doc("a", "2026-11-09T10:00:00.000Z")]);

    const result = await getMessages(7, undefined, 20);

    expect(mockFind).toHaveBeenCalledWith({ room_id: 7 });
    expect(mockSort).toHaveBeenCalledWith({ sent_at: -1 });
    expect(mockLimit).toHaveBeenCalledWith(20);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("a");
    expect(result.nextCursor).toBeNull();
  });

  it("filtra pelo cursor e devolve o próximo quando a página vem cheia", async () => {
    mockLean.mockResolvedValue([
      doc("b", "2026-11-09T09:00:00.000Z"),
      doc("c", "2026-11-09T08:00:00.000Z"),
    ]);

    const result = await getMessages(7, "2026-11-09T10:00:00.000Z", 2);

    expect(mockFind).toHaveBeenCalledWith({
      room_id: 7,
      sent_at: { $lt: new Date("2026-11-09T10:00:00.000Z") },
    });
    expect(result.nextCursor).toBe("2026-11-09T08:00:00.000Z");
  });

  it("ignora cursor inválido e usa o limite padrão de 20", async () => {
    mockLean.mockResolvedValue([]);

    const result = await getMessages(7, "nao-e-data");

    expect(mockFind).toHaveBeenCalledWith({ room_id: 7 });
    expect(mockLimit).toHaveBeenCalledWith(20);
    expect(result).toEqual({ messages: [], nextCursor: null });
  });

  it("lança ChatMongoUnavailableError quando o MongoDB do chat está fora", async () => {
    mocked(isChatMongoReady).mockReturnValue(false);

    await expect(getMessages(7)).rejects.toBeInstanceOf(ChatMongoUnavailableError);
    await expect(getMessages(7)).rejects.toMatchObject({
      name: "ChatMongoUnavailableError",
      message: expect.stringContaining("MONGODB_CHAT_URI"),
    });
    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe("chat.service resolveParticipant", () => {
  it("devolve os perfis de cliente e profissional do usuário", async () => {
    mockProfiles(3, 4);

    await expect(resolveParticipant(1)).resolves.toEqual({
      clientId: 3,
      professionalId: 4,
    });
    expect(ClientModel.findOne).toHaveBeenCalledWith({ where: { user_id: 1 } });
    expect(ProfessionalModel.findOne).toHaveBeenCalledWith({
      where: { user_id: 1 },
    });
  });

  it("devolve null para os perfis que não existem", async () => {
    mockProfiles(null, null);

    await expect(resolveParticipant(1)).resolves.toEqual({
      clientId: null,
      professionalId: null,
    });
  });
});

describe("chat.service assertParticipant", () => {
  const room = { id: 9, client_id: 3, professional_id: 4, status: "active" };

  it("devolve null quando a sala não existe", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(null);

    await expect(assertParticipant(9, 1)).resolves.toBeNull();
    expect(ClientModel.findOne).not.toHaveBeenCalled();
  });

  it("reconhece o cliente da sala", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(room);
    mockProfiles(3, null);

    await expect(assertParticipant(9, 1)).resolves.toEqual({
      room,
      role: "client",
    });
  });

  it("reconhece o profissional da sala", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(room);
    mockProfiles(99, 4);

    await expect(assertParticipant(9, 1)).resolves.toEqual({
      room,
      role: "professional",
    });
  });

  it("devolve null para quem não participa da sala", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(room);
    mockProfiles(99, 98);

    await expect(assertParticipant(9, 1)).resolves.toBeNull();
  });

  it("devolve null para usuário sem perfis", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(room);
    mockProfiles(null, null);

    await expect(assertParticipant(9, 1)).resolves.toBeNull();
  });
});

describe("chat.service listRooms", () => {
  const roomAsClient = {
    id: 1,
    appointment_id: 10,
    service_id: 20,
    status: "active",
    client_id: 3,
    professional_id: 50,
    last_message_preview: "olá",
    last_message_at: new Date("2026-11-20T10:00:00.000Z"),
    Service: { title: "Pintura" },
    Client: { User: { id: 100, name: "Cliente" } },
    Professional: {
      User: { id: 200, name: "Profissional", avatar_uri: "https://img/p.png" },
    },
  };
  const roomAsProfessional = {
    id: 2,
    appointment_id: 11,
    service_id: 21,
    status: "archived",
    client_id: 60,
    professional_id: 4,
    Client: { User: { id: 300, name: "Outro cliente" } },
  };

  it("devolve lista vazia para usuário sem perfis, sem sincronizar", async () => {
    mockProfiles(null, null);

    await expect(listRooms(1001)).resolves.toEqual([]);
    expect(ChatRoomModel.findAll).not.toHaveBeenCalled();
    expect(syncChatRoomsForUser).not.toHaveBeenCalled();
  });

  it("mapeia o correspondente do outro lado da conversa", async () => {
    mockProfiles(3, 4);
    mocked(ChatRoomModel.findAll).mockResolvedValue([
      roomAsClient,
      roomAsProfessional,
    ]);

    const result = await listRooms(1002);

    const query = mocked(ChatRoomModel.findAll).mock.calls[0][0];
    expect(query.where).toEqual({
      [Op.or]: [{ client_id: 3 }, { professional_id: 4 }],
    });
    expect(query.limit).toBe(50);
    expect(result).toEqual([
      {
        room_id: 1,
        appointment_id: 10,
        service_id: 20,
        service_title: "Pintura",
        status: "active",
        correspondent: {
          user_id: 200,
          name: "Profissional",
          avatar_uri: "https://img/p.png",
        },
        last_message_preview: "olá",
        last_message_at: new Date("2026-11-20T10:00:00.000Z"),
      },
      {
        room_id: 2,
        appointment_id: 11,
        service_id: 21,
        service_title: null,
        status: "archived",
        correspondent: { user_id: 300, name: "Outro cliente", avatar_uri: null },
        last_message_preview: null,
        last_message_at: null,
      },
    ]);
  });

  it("devolve correspondente null quando o outro lado não tem usuário", async () => {
    mockProfiles(3, null);
    mocked(ChatRoomModel.findAll).mockResolvedValue([
      { ...roomAsClient, Professional: undefined },
    ]);

    const [room] = await listRooms(1003);

    expect(mocked(ChatRoomModel.findAll).mock.calls[0][0].where).toEqual({
      [Op.or]: [{ client_id: 3 }],
    });
    expect(room.correspondent).toBeNull();
  });

  it.each([
    [undefined, 50],
    [Number.NaN, 50],
    [0, 50],
    [10.9, 10],
    [500, 100],
  ])("normaliza o limite %p para %p", async (limit, expected) => {
    mockProfiles(null, 4);
    mocked(ChatRoomModel.findAll).mockResolvedValue([]);

    await listRooms(1004, { limit });

    expect(mocked(ChatRoomModel.findAll).mock.calls[0][0].limit).toBe(expected);
  });

  it("sincroniza as salas em background respeitando o intervalo mínimo", async () => {
    mockProfiles(3, null);
    mocked(ChatRoomModel.findAll).mockResolvedValue([]);

    await listRooms(1005);
    await listRooms(1005);
    expect(syncChatRoomsForUser).toHaveBeenCalledTimes(1);
    expect(syncChatRoomsForUser).toHaveBeenCalledWith(1005);

    await flushPromises();
    await listRooms(1005);
    expect(syncChatRoomsForUser).toHaveBeenCalledTimes(1);
  });

  it("sincroniza de novo depois do intervalo mínimo", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    try {
      mockProfiles(3, null);
      mocked(ChatRoomModel.findAll).mockResolvedValue([]);

      nowSpy.mockReturnValue(1_000_000_000_000);
      await listRooms(1006);
      await flushPromises();

      nowSpy.mockReturnValue(1_000_000_000_000 + 5 * 60 * 1000 + 1);
      await listRooms(1006);

      expect(syncChatRoomsForUser).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("registra aviso quando o sync em background falha, sem afetar a listagem", async () => {
    mockProfiles(3, null);
    mocked(ChatRoomModel.findAll).mockResolvedValue([]);
    const failure = new Error("sync falhou");
    mocked(syncChatRoomsForUser).mockRejectedValue(failure);

    await expect(listRooms(1007)).resolves.toEqual([]);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      "Falha no sync assíncrono de salas de chat",
      { userId: 1007, error: failure },
    );
  });
});

describe("chat.service persistMessage", () => {
  const params = {
    roomId: 7,
    clientMessageUuid: "uuid-x",
    senderUserId: 1,
    senderRole: "client" as const,
    text: "olá",
    sentAt: new Date("2026-11-09T10:00:00.000Z"),
  };

  it("lança ChatMongoUnavailableError quando o MongoDB do chat está fora", async () => {
    mocked(isChatMongoReady).mockReturnValue(false);

    await expect(persistMessage(params)).rejects.toBeInstanceOf(
      ChatMongoUnavailableError,
    );
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("devolve a mensagem existente em reenvio, sem gravar de novo", async () => {
    mockFindOneLean.mockResolvedValue(doc("x", "2026-11-09T10:00:00.000Z"));

    const result = await persistMessage(params);

    expect(mockFindOne).toHaveBeenCalledWith({ client_message_uuid: "uuid-x" });
    expect(result.isNew).toBe(false);
    expect(result.message.id).toBe("x");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(ChatRoomModel.update).not.toHaveBeenCalled();
  });

  it("grava a mensagem nova e atualiza a prévia da sala", async () => {
    const longText = "a".repeat(300);
    const created = doc("novo", "2026-11-09T10:00:00.000Z");
    mockFindOneLean.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ toObject: () => created });

    const result = await persistMessage({ ...params, text: longText });

    expect(mockCreate).toHaveBeenCalledWith({
      room_id: 7,
      client_message_uuid: "uuid-x",
      sender_user_id: 1,
      sender_role: "client",
      text: longText,
      sent_at: params.sentAt,
      created_at: expect.any(Date),
    });
    expect(ChatRoomModel.update).toHaveBeenCalledWith(
      {
        last_message_preview: "a".repeat(280),
        last_message_at: params.sentAt,
        last_sender_user_id: 1,
      },
      { where: { id: 7 } },
    );
    expect(result).toEqual({
      isNew: true,
      message: {
        id: "novo",
        room_id: 7,
        client_message_uuid: "uuid-novo",
        sender_user_id: 1,
        sender_role: "client",
        text: "msg novo",
        sent_at: created.sent_at,
        created_at: created.created_at,
      },
    });
  });
});

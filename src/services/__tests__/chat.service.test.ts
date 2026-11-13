jest.mock("../../config/database", () => ({
  isChatMongoReady: jest.fn(),
  sequelize: {},
  connectMongo: jest.fn(),
  chatMongoConnection: { model: jest.fn(), on: jest.fn(), readyState: 0 },
}));

jest.mock("../../models/ChatMessage", () => ({
  ChatMessage: {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../../models/ChatRoom", () => ({
  ChatRoomModel: { findAll: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
}));

jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));

jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn() },
}));

jest.mock("../../models/Service", () => ({
  ServiceModel: {},
}));

jest.mock("../../models/User", () => ({
  UserModel: {},
}));

jest.mock("../../utils/chatRoom", () => ({
  syncChatRoomsForUser: jest.fn().mockResolvedValue(undefined),
}));

import { isChatMongoReady } from "../../config/database";
import { ChatMessage } from "../../models/ChatMessage";
import { ChatRoomModel } from "../../models/ChatRoom";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import {
  ChatMongoUnavailableError,
  getMessages,
  listRooms,
  persistMessage,
} from "../chat.service";

const ready = isChatMongoReady as unknown as jest.Mock;
const find = ChatMessage.find as jest.Mock;
const findOne = ChatMessage.findOne as jest.Mock;
const create = ChatMessage.create as jest.Mock;

describe("chat.service", () => {
  it("returns no rooms when the user has neither profile", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);

    await expect(listRooms(4)).resolves.toEqual([]);
    expect(ChatRoomModel.findAll).not.toHaveBeenCalled();
  });

  it("throws ChatMongoUnavailableError when chat mongo is down", async () => {
    ready.mockReturnValue(false);
    await expect(getMessages(1)).rejects.toBeInstanceOf(
      ChatMongoUnavailableError,
    );
  });

  it("returns messages when chat mongo is ready", async () => {
    ready.mockReturnValue(true);
    const sentAt = new Date("2026-05-01T12:00:00.000Z");
    const lean = jest.fn().mockResolvedValue([
      {
        _id: "abc",
        room_id: 1,
        client_message_uuid: "uuid-1",
        sender_user_id: 4,
        sender_role: "client",
        text: "oi",
        sent_at: sentAt,
        created_at: sentAt,
      },
    ]);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    find.mockReturnValue({ sort });

    const result = await getMessages(1, undefined, 20);

    expect(result.messages[0]).toMatchObject({ id: "abc", text: "oi" });
    expect(result.nextCursor).toBeNull();
  });

  it("persists a new message and updates the room preview", async () => {
    ready.mockReturnValue(true);
    findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const sentAt = new Date("2026-05-01T12:00:00.000Z");
    const doc = {
      _id: "msg-1",
      room_id: 3,
      client_message_uuid: "uuid-2",
      sender_user_id: 4,
      sender_role: "client" as const,
      text: "olá",
      sent_at: sentAt,
      created_at: sentAt,
    };
    create.mockResolvedValue({ toObject: () => doc });
    (ChatRoomModel.update as jest.Mock).mockResolvedValue([1]);

    const result = await persistMessage({
      roomId: 3,
      clientMessageUuid: "uuid-2",
      senderUserId: 4,
      senderRole: "client",
      text: "olá",
      sentAt,
    });

    expect(result.isNew).toBe(true);
    expect(result.message.id).toBe("msg-1");
    expect(ChatRoomModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_message_preview: "olá" }),
      { where: { id: 3 } },
    );
  });
});

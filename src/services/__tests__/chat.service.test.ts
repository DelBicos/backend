const mockLean = jest.fn();
const mockLimit = jest.fn(() => ({ lean: mockLean }));
const mockSort = jest.fn(() => ({ limit: mockLimit }));
const mockFind = jest.fn(() => ({ sort: mockSort }));

jest.mock("../../models/ChatMessage", () => ({
  ChatMessage: { find: mockFind },
}));
jest.mock("../../config/database", () => ({
  isChatMongoReady: () => true,
}));
jest.mock("../../models/ChatRoom", () => ({ ChatRoomModel: {} }));
jest.mock("../../models/Client", () => ({ ClientModel: {} }));
jest.mock("../../models/Professional", () => ({ ProfessionalModel: {} }));
jest.mock("../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../utils/chatRoom", () => ({ syncChatRoomsForUser: jest.fn() }));

import { getMessages } from "../chat.service";

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
});

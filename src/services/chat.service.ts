import { Op, literal } from "sequelize";
import { ChatRoomModel } from "../models/ChatRoom";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import { ServiceModel } from "../models/Service";
import { UserModel } from "../models/User";
import { ChatMessage, IChatMessage } from "../models/ChatMessage";
import { syncChatRoomsForUser } from "../utils/chatRoom";
import { isChatMongoReady } from "../config/database";
import logger from "../utils/logger";

const DEFAULT_CHAT_ROOMS_LIMIT = 50;
const MAX_CHAT_ROOMS_LIMIT = 100;
const CHAT_ROOMS_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

const lastChatRoomsSyncAtByUser = new Map<number, number>();
const inFlightChatRoomsSyncByUser = new Map<number, Promise<void>>();

export class ChatMongoUnavailableError extends Error {
  constructor() {
    super(
      "MongoDB do chat indisponível. Verifique MONGODB_CHAT_URI (no Docker: mongodb://mongo:27017/delbicos_chat).",
    );
    this.name = "ChatMongoUnavailableError";
  }
}

function assertChatMongoReady(): void {
  if (!isChatMongoReady()) {
    throw new ChatMongoUnavailableError();
  }
}

export type ChatRole = "client" | "professional";

export interface ChatParticipant {
  clientId: number | null;
  professionalId: number | null;
}

export interface ChatRoomListItem {
  room_id: number;
  appointment_id: number;
  service_id: number;
  service_title: string | null;
  status: "active" | "archived";
  correspondent: {
    user_id: number;
    name: string;
    avatar_uri: string | null;
  } | null;
  last_message_preview: string | null;
  last_message_at: Date | null;
}

export interface ChatMessageDTO {
  id: string;
  room_id: number;
  client_message_uuid: string;
  sender_user_id: number;
  sender_role: ChatRole;
  text: string;
  sent_at: Date;
  created_at: Date;
}

/**
 * Resolve os perfis (client/professional) de um usuário.
 */
export async function resolveParticipant(
  userId: number,
): Promise<ChatParticipant> {
  const [client, professional] = await Promise.all([
    ClientModel.findOne({ where: { user_id: userId } }),
    ProfessionalModel.findOne({ where: { user_id: userId } }),
  ]);

  return {
    clientId: client?.id ?? null,
    professionalId: professional?.id ?? null,
  };
}

/**
 * Garante que o usuário é participante da sala (como cliente ou profissional).
 * Retorna a sala e o papel do usuário, ou null se não for participante.
 */
export async function assertParticipant(
  roomId: number,
  userId: number,
): Promise<{ room: ChatRoomModel; role: ChatRole } | null> {
  const room = await ChatRoomModel.findByPk(roomId);
  if (!room) return null;

  const { clientId, professionalId } = await resolveParticipant(userId);

  if (clientId !== null && room.client_id === clientId) {
    return { room, role: "client" };
  }
  if (professionalId !== null && room.professional_id === professionalId) {
    return { room, role: "professional" };
  }
  return null;
}

const mapMessage = (doc: IChatMessage & { _id: unknown }): ChatMessageDTO => ({
  id: String(doc._id),
  room_id: doc.room_id,
  client_message_uuid: doc.client_message_uuid,
  sender_user_id: doc.sender_user_id,
  sender_role: doc.sender_role,
  text: doc.text,
  sent_at: doc.sent_at,
  created_at: doc.created_at,
});

function normalizeRoomsLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_CHAT_ROOMS_LIMIT;
  const parsedLimit = Math.trunc(Number(limit));
  if (parsedLimit < 1) return DEFAULT_CHAT_ROOMS_LIMIT;
  return Math.min(parsedLimit, MAX_CHAT_ROOMS_LIMIT);
}

function scheduleChatRoomsSync(userId: number): void {
  if (inFlightChatRoomsSyncByUser.has(userId)) return;

  const now = Date.now();
  const lastSyncAt = lastChatRoomsSyncAtByUser.get(userId) ?? 0;
  if (now - lastSyncAt < CHAT_ROOMS_SYNC_COOLDOWN_MS) return;

  const syncTask = syncChatRoomsForUser(userId)
    .catch((error) => {
      logger.warn("Falha no sync assíncrono de salas de chat", {
        userId,
        error,
      });
    })
    .finally(() => {
      inFlightChatRoomsSyncByUser.delete(userId);
      lastChatRoomsSyncAtByUser.set(userId, Date.now());
    });

  inFlightChatRoomsSyncByUser.set(userId, syncTask);
}

/**
 * Lista as salas de chat do usuário com dados do correspondente e última mensagem.
 */
type ParticipantUser = { id: number; name: string; avatar_uri?: string | null };
type RoomWithParticipants = ChatRoomModel & {
  Service?: { title: string };
  Client?: { User?: ParticipantUser };
  Professional?: { User?: ParticipantUser };
};

export async function listRooms(
  userId: number,
  options?: { limit?: number },
): Promise<ChatRoomListItem[]> {
  const { clientId, professionalId } = await resolveParticipant(userId);

  if (clientId === null && professionalId === null) return [];

  // O sync roda em background para não bloquear a leitura em contas com histórico grande.
  scheduleChatRoomsSync(userId);

  const limit = normalizeRoomsLimit(options?.limit);

  const orConditions: Record<string, number>[] = [];
  if (clientId !== null) orConditions.push({ client_id: clientId });
  if (professionalId !== null)
    orConditions.push({ professional_id: professionalId });

  const rooms = await ChatRoomModel.findAll({
    where: { [Op.or]: orConditions },
    include: [
      {
        model: ServiceModel,
        as: "Service",
        attributes: ["id", "title"],
      },
      {
        model: ClientModel,
        as: "Client",
        include: [
          {
            model: UserModel,
            as: "User",
            attributes: ["id", "name", "avatar_uri"],
          },
        ],
      },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [
          {
            model: UserModel,
            as: "User",
            attributes: ["id", "name", "avatar_uri"],
          },
        ],
      },
    ],
    order: [
      // active antes de archived ('active' < 'archived' alfabeticamente)
      ["status", "ASC"],
      [literal("last_message_at IS NULL"), "ASC"],
      ["last_message_at", "DESC"],
    ],
    limit,
  });

  return (rooms as RoomWithParticipants[]).map((room) => {
    const data = room;
    const isClient = clientId !== null && room.client_id === clientId;
    // O correspondente é o "outro lado" da conversa
    const correspondentUser = isClient
      ? data.Professional?.User
      : data.Client?.User;

    return {
      room_id: room.id,
      appointment_id: room.appointment_id,
      service_id: room.service_id,
      service_title: data.Service?.title ?? null,
      status: room.status,
      correspondent: correspondentUser
        ? {
            user_id: correspondentUser.id,
            name: correspondentUser.name,
            avatar_uri: correspondentUser.avatar_uri ?? null,
          }
        : null,
      last_message_preview: room.last_message_preview ?? null,
      last_message_at: room.last_message_at ?? null,
    };
  });
}

/**
 * Histórico paginado por cursor (sent_at). Retorna mensagens mais recentes primeiro.
 */
export async function getMessages(
  roomId: number,
  cursor?: string,
  limit = 20,
): Promise<{ messages: ChatMessageDTO[]; nextCursor: string | null }> {
  assertChatMongoReady();

  const query: { room_id: number; sent_at?: { $lt: Date } } = { room_id: roomId };
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (!isNaN(cursorDate.getTime())) {
      query.sent_at = { $lt: cursorDate };
    }
  }

  const docs = await ChatMessage.find(query)
    .sort({ sent_at: -1, _id: -1 })
    .limit(limit)
    .lean<(IChatMessage & { _id: unknown })[]>();

  const messages = docs.map(mapMessage);
  const nextCursor =
    docs.length === limit ? docs[docs.length - 1].sent_at.toISOString() : null;

  return { messages, nextCursor };
}

/**
 * Persiste uma mensagem no MongoDB e atualiza os metadados da sala no SQL.
 * Idempotente via client_message_uuid (unique). Em reenvio, retorna a existente.
 */
export async function persistMessage(params: {
  roomId: number;
  clientMessageUuid: string;
  senderUserId: number;
  senderRole: ChatRole;
  text: string;
  sentAt: Date;
}): Promise<{ message: ChatMessageDTO; isNew: boolean }> {
  assertChatMongoReady();

  const { roomId, clientMessageUuid, senderUserId, senderRole, text, sentAt } =
    params;

  const existing = await ChatMessage.findOne({
    client_message_uuid: clientMessageUuid,
  }).lean<(IChatMessage & { _id: unknown }) | null>();

  if (existing) {
    return { message: mapMessage(existing), isNew: false };
  }

  const created = await ChatMessage.create({
    room_id: roomId,
    client_message_uuid: clientMessageUuid,
    sender_user_id: senderUserId,
    sender_role: senderRole,
    text,
    sent_at: sentAt,
    created_at: new Date(),
  });

  await ChatRoomModel.update(
    {
      last_message_preview: text.slice(0, 280),
      last_message_at: sentAt,
      last_sender_user_id: senderUserId,
    },
    { where: { id: roomId } },
  );

  return {
    message: mapMessage(created.toObject() as IChatMessage & { _id: unknown }),
    isNew: true,
  };
}

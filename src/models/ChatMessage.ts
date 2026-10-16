import { Model, Schema } from "mongoose";
import { chatMongoConnection } from "../config/database";

export interface IChatMessage {
  room_id: number;
  client_message_uuid: string;
  sender_user_id: number;
  sender_role: "client" | "professional";
  text: string;
  sent_at: Date;
  created_at: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  room_id: { type: Number, required: true },
  client_message_uuid: { type: String, required: true },
  sender_user_id: { type: Number, required: true },
  sender_role: {
    type: String,
    enum: ["client", "professional"],
    required: true,
  },
  text: { type: String, required: true },
  sent_at: { type: Date, required: true },
  created_at: { type: Date, default: Date.now },
});

// Histórico paginado por sala ordenado por data de envio
ChatMessageSchema.index({ room_id: 1, sent_at: -1 });
// Idempotência: evita gravar a mesma mensagem em reenvios/reconexões
ChatMessageSchema.index({ client_message_uuid: 1 }, { unique: true });

const createMockQuery = () => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
  lean: () => Promise.resolve(null),
});

export const ChatMessage: Model<IChatMessage> = chatMongoConnection?.model
  ? chatMongoConnection.model<IChatMessage>(
      "ChatMessage",
      ChatMessageSchema,
      "chat_messages",
    )
  : (({
      find: createMockQuery,
      findOne: createMockQuery,
      create: () => Promise.resolve({ toObject: () => ({}) }),
    } as unknown) as Model<IChatMessage>);

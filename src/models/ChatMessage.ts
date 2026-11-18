import { Schema } from "mongoose";
import { chatMongoConnection } from "../config/database";
import { logError } from "../utils/logger";

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

// O Cosmos DB (API Mongo) só ordena por campo que tenha índice próprio; o
// composto abaixo não serve para o sort({ sent_at: -1 }) do histórico. Fica
// antes do índice único, que o Cosmos pode recusar em coleção já populada.
ChatMessageSchema.index({ sent_at: -1 });
// Histórico paginado por sala ordenado por data de envio
ChatMessageSchema.index({ room_id: 1, sent_at: -1 });
// Idempotência: evita gravar a mesma mensagem em reenvios/reconexões
ChatMessageSchema.index({ client_message_uuid: 1 }, { unique: true });

export const ChatMessage = chatMongoConnection.model<IChatMessage>(
  "ChatMessage",
  ChatMessageSchema,
  "chat_messages",
);

// A criação automática de índices falha em silêncio; sem o índice de sent_at
// o histórico quebra no Cosmos, então o erro precisa aparecer no log.
ChatMessage.on("index", (error?: Error) => {
  if (error) logError("Falha ao criar índices de chat_messages:", error);
});

import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export interface IBotChatMessage {
  id?: number;
  session_id: number;
  sender: "user" | "bot";
  content: string;
  intent?: string | null;
  entities?: Record<string, unknown> | null;
}

type BotChatMessageCreationalAttributes = Optional<
  IBotChatMessage,
  "id" | "intent" | "entities"
>;

export class BotChatMessageModel extends Model<
  IBotChatMessage,
  BotChatMessageCreationalAttributes
> {
  public id!: number;
  public session_id!: number;
  public sender!: "user" | "bot";
  public content!: string;
  public intent!: string | null;
  public entities!: Record<string, unknown> | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BotChatMessageModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    session_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "bot_chat_session", key: "id" },
    },
    sender: {
      type: DataTypes.ENUM("user", "bot"),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    intent: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    entities: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "bot_chat_message",
    underscored: true,
    timestamps: true,
  }
);

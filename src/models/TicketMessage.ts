import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

/*
CREATE TABLE ticket_message (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    author_id INT NOT NULL,
    author_type ENUM('CLIENTE','PRESTADOR','ADMIN') NOT NULL,
    content TEXT NOT NULL,
    attachment_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
)
*/

export type MessageAuthorType = "CLIENTE" | "PRESTADOR" | "ADMIN";

export interface ITicketMessage {
  id?: number;
  ticket_id: number;
  author_id: number;
  author_type: MessageAuthorType;
  content: string;
  attachment_url?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type TicketMessageCreationalAttributes = Optional<
  ITicketMessage,
  "id" | "attachment_url" | "createdAt" | "updatedAt"
>;

export class TicketMessageModel extends Model<
  ITicketMessage,
  TicketMessageCreationalAttributes
> implements ITicketMessage {
  declare id: number;
  declare ticket_id: number;
  declare author_id: number;
  declare author_type: MessageAuthorType;
  declare content: string;
  declare attachment_url: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

TicketMessageModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    ticket_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "ticket",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    author_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    author_type: {
      type: DataTypes.ENUM("CLIENTE", "PRESTADOR", "ADMIN"),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachment_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "ticket_message",
    underscored: true,
    timestamps: true,
    indexes: [
      { name: "idx_ticket_message_ticket", fields: ["ticket_id"] },
      { name: "idx_ticket_message_created", fields: ["created_at"] },
    ],
  }
);

export default TicketMessageModel;
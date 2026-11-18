import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

/*
CREATE TABLE ticket (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_code VARCHAR(10) UNIQUE NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    category ENUM(...) NOT NULL,
    priority ENUM(...),
    status ENUM(...) NOT NULL DEFAULT 'ABERTO',
    user_id INT NOT NULL,
    user_type ENUM('CLIENTE','PRESTADOR') NOT NULL,
    admin_id INT,
    appointment_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ...
)
*/

export type TicketCategory =
  | "AGENDAMENTO"
  | "PAGAMENTO"
  | "SERVICO"
  | "PRESTADOR"
  | "CLIENTE"
  | "SUGESTAO"
  | "OUTROS";

export type TicketPriority = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";

export type TicketStatus =
  | "ABERTO"
  | "EM_ANALISE"
  | "EM_ATENDIMENTO"
  | "RESOLVIDO"
  | "FECHADO";

export type TicketUserType = "CLIENTE" | "PRESTADOR";

export interface ITicket {
  id?: number;
  ticket_code: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority?: TicketPriority | null;
  status: TicketStatus;
  user_id: number;
  user_type: TicketUserType;
  admin_id?: number | null;
  appointment_id?: number | null;
  createdAt?: Date;    // ✅ camelCase
  updatedAt?: Date;    // ✅ camelCase
}

type TicketCreationalAttributes = Optional<
  ITicket,
  | "id"
  | "ticket_code"
  | "priority"
  | "status"
  | "admin_id"
  | "appointment_id"
  | "createdAt"
  | "updatedAt"
>;

export class Ticket extends Model<ITicket, TicketCreationalAttributes> {
  declare id: number;
  declare ticket_code: string;
  declare title: string;
  declare description: string;
  declare category: TicketCategory;
  declare priority: TicketPriority | null;
  declare status: TicketStatus;
  declare user_id: number;
  declare user_type: TicketUserType;
  declare admin_id: number | null;
  declare appointment_id: number | null;
  declare createdAt: Date;    // ✅ camelCase
  declare updatedAt: Date;    // ✅ camelCase
}

Ticket.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    ticket_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
    },
    title: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    category: {
      type: DataTypes.ENUM(
        "AGENDAMENTO",
        "PAGAMENTO",
        "SERVICO",
        "PRESTADOR",
        "CLIENTE",
        "SUGESTAO",
        "OUTROS"
      ),
      allowNull: false,
    },
    priority: {
      type: DataTypes.ENUM("BAIXA", "MEDIA", "ALTA", "CRITICA"),
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.ENUM(
        "ABERTO",
        "EM_ANALISE",
        "EM_ATENDIMENTO",
        "RESOLVIDO",
        "FECHADO"
      ),
      allowNull: false,
      defaultValue: "ABERTO",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    user_type: {
      type: DataTypes.ENUM("CLIENTE", "PRESTADOR"),
      allowNull: false,
    },
    admin_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    appointment_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "appointment", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
  },
  {
    sequelize,
    tableName: "ticket",
    underscored: true,
    timestamps: true,
    indexes: [
      { name: "idx_ticket_user", fields: ["user_id"] },
      { name: "idx_ticket_status", fields: ["status"] },
      { name: "idx_ticket_priority_status", fields: ["priority", "status"] },
      { name: "idx_ticket_created_at", fields: ["created_at"] },
    ],
  }
);

export default Ticket;
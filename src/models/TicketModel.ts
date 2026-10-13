// src/models/TicketModel.ts
import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

/*
CREATE TABLE ticket (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_code VARCHAR(10) UNIQUE NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    category ENUM('AGENDAMENTO','PAGAMENTO','SERVICO','PRESTADOR','CLIENTE','SUGESTAO','OUTROS') NOT NULL,
    priority ENUM('BAIXA','MEDIA','ALTA','CRITICA') NOT NULL,
    status ENUM('ABERTO','EM_ANALISE','EM_ATENDIMENTO','RESOLVIDO','FECHADO') NOT NULL DEFAULT 'ABERTO',
    user_id INT NOT NULL,
    user_type ENUM('CLIENTE','PRESTADOR') NOT NULL,
    admin_id INT,
    appointment_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (admin_id) REFERENCES users(id),
    FOREIGN KEY (appointment_id) REFERENCES appointment(id)
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
  priority: TicketPriority;
  status: TicketStatus;
  user_id: number;
  user_type: TicketUserType;
  admin_id?: number | null;
  appointment_id?: number | null;
  created_at?: Date;
  updated_at?: Date;
}

type TicketCreationalAttributes = Optional<
  ITicket,
  | "id"
  | "ticket_code"
  | "status"
  | "admin_id"
  | "appointment_id"
  | "created_at"
  | "updated_at"
>;

export class TicketModel extends Model<
  ITicket,
  TicketCreationalAttributes
> implements ITicket {
  declare id: number;
  declare ticket_code: string;
  declare title: string;
  declare description: string;
  declare category: TicketCategory;
  declare priority: TicketPriority;
  declare status: TicketStatus;
  declare user_id: number;
  declare user_type: TicketUserType;
  declare admin_id: number | null;
  declare appointment_id: number | null;
  declare created_at: Date;
  declare updated_at: Date;
}

TicketModel.init(
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
      allowNull: false,
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
      references: { model: "user", key: "id" },
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
      references: { model: "user", key: "id" },
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

export default TicketModel;
import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

import { BotState } from "../constants/botStates";

export type BotSessionState = `${BotState}`;

export type BotSessionStatus = "active" | "completed" | "abandoned";

export type BotPendingAction = "CREATE" | "CANCEL" | "RESCHEDULE";

export interface BotSessionContext {
  intent?: string;
  pendingAction?: BotPendingAction;
  serviceId?: number;
  serviceName?: string;
  servicePrice?: number;
  serviceDuration?: number;
  professionalId?: number;
  professionalName?: string;
  date?: string;        // YYYY-MM-DD
  time?: string;        // HH:MM
  newDate?: string;     // YYYY-MM-DD (para ALTERAR)
  newTime?: string;     // HH:MM (para ALTERAR)
  appointmentId?: number;
  appointmentStatus?: "pending" | "confirmed" | "completed" | "canceled";
  suggestedSlots?: string[];
  serviceOptions?: string[];
  serviceOptionsData?: Array<{
    id: number;
    title: string;
    professionalId: number;
    professionalName: string;
    price: number;
    duration: number;
  }>;
  pendingService?: {
    id: number;
    title: string;
    professionalId: number;
    professionalName: string;
    price: number;
    duration: number;
  } | null;
  matchedServiceIds?: number[];
  suggestedSlotsData?: Array<{
    index: number;
    serviceId: number;
    professionalId: number;
    professionalName: string;
    price: number;
    duration: number;
    time: string;
  }>;
  suggestedDates?: string[];
}

export interface IBotChatSession {
  id?: number;
  user_id: number;
  auth_session_id: string;
  channel: string;
  status: BotSessionStatus;
  state: BotSessionState;
  context?: BotSessionContext | null;
  appointment_id?: number | null;
  started_at?: Date;
  ended_at?: Date | null;
}

type BotChatSessionCreationalAttributes = Optional<
  IBotChatSession,
  "id" | "status" | "state" | "context" | "appointment_id" | "started_at" | "ended_at"
>;

export class BotChatSessionModel extends Model<
  IBotChatSession,
  BotChatSessionCreationalAttributes
> {
  public id!: number;
  public user_id!: number;
  public auth_session_id!: string;
  public channel!: string;
  public status!: BotSessionStatus;
  public state!: BotSessionState;
  public context!: BotSessionContext | null;
  public appointment_id!: number | null;
  public started_at!: Date;
  public ended_at!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BotChatSessionModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    auth_session_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    channel: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "web",
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "abandoned"),
      allowNull: false,
      defaultValue: "active",
    },
    state: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "INICIO",
    },
    context: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    appointment_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "appointment", key: "id" },
    },
    started_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "bot_chat_session",
    underscored: true,
    timestamps: true,
  }
);

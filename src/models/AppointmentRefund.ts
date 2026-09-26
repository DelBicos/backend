import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

interface AppointmentRefund {
  id: number;
  appointment_id: number;
  payment_intent_id: string;
  status: "pending" | "completed";
  attempts: number;
  next_attempt_at: Date;
  last_error?: string | null;
}

/** Outbox financeira: sobrevive ao cancelamento e a reinícios do processo. */
export class AppointmentRefundModel extends Model<
  AppointmentRefund,
  Optional<AppointmentRefund, "id" | "status" | "attempts" | "next_attempt_at">
> implements AppointmentRefund {
  declare id: number;
  declare appointment_id: number;
  declare payment_intent_id: string;
  declare status: "pending" | "completed";
  declare attempts: number;
  declare next_attempt_at: Date;
  declare last_error: string | null;
}

AppointmentRefundModel.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  appointment_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: "appointment", key: "id" },
    onDelete: "RESTRICT", onUpdate: "CASCADE",
  },
  payment_intent_id: { type: DataTypes.STRING, allowNull: false, unique: true },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  next_attempt_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  last_error: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize, tableName: "appointment_refund", underscored: true, timestamps: true,
  indexes: [{ name: "idx_appointment_refund_due", fields: ["status", "next_attempt_at"] }],
});

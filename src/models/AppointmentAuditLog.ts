import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

const IMMUTABLE_ERROR =
  "appointment_audit_log é append-only: registros não podem ser alterados ou removidos.";

export type AuditLogAction =
  | "check_in"
  | "check_out"
  | "check_in_failed"
  | "check_out_failed"
  | "status_change";

export interface IAppointmentAuditLog {
  id?: number;
  appointment_id: number;
  user_id?: number | null;
  action: AuditLogAction;
  from_status?: string | null;
  to_status?: string | null;
  metadata?: string | null;
  created_at?: Date;
}

type AppointmentAuditLogCreational = Optional<
  IAppointmentAuditLog,
  "id" | "user_id" | "from_status" | "to_status" | "metadata" | "created_at"
>;

export class AppointmentAuditLogModel
  extends Model<IAppointmentAuditLog, AppointmentAuditLogCreational>
  implements IAppointmentAuditLog
{
  declare id: number;
  declare appointment_id: number;
  declare user_id: number | null;
  declare action: AuditLogAction;
  declare from_status: string | null;
  declare to_status: string | null;
  declare metadata: string | null;
  declare created_at: Date;
}

AppointmentAuditLogModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    appointment_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "appointment",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    from_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    to_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "appointment_audit_log",
    underscored: true,
    timestamps: false, // Append-only: logs imutáveis com apenas created_at
    indexes: [
      {
        name: "idx_appointment_audit_log_appt",
        fields: ["appointment_id"],
      },
      {
        name: "idx_appointment_audit_log_action",
        fields: ["action"],
      },
    ],
    hooks: {
      beforeUpdate: () => {
        throw new Error(IMMUTABLE_ERROR);
      },
      beforeBulkUpdate: () => {
        throw new Error(IMMUTABLE_ERROR);
      },
      beforeDestroy: () => {
        throw new Error(IMMUTABLE_ERROR);
      },
      beforeBulkDestroy: () => {
        throw new Error(IMMUTABLE_ERROR);
      },
    },
  }
);

import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/database";

interface CancellationVerification {
  user_id: number;
  appointment_id: number;
  challenge_id: string;
  email: string;
  code_hash: string;
  salt: string;
  attempts: number;
  expires_at: Date;
  last_sent_at: Date;
  window_started_at: Date;
  send_count: number;
  consumed: boolean;
}

export class CancellationVerificationModel extends Model<CancellationVerification>
  implements CancellationVerification {
  declare user_id: number;
  declare appointment_id: number;
  declare challenge_id: string;
  declare email: string;
  declare code_hash: string;
  declare salt: string;
  declare attempts: number;
  declare expires_at: Date;
  declare last_sent_at: Date;
  declare window_started_at: Date;
  declare send_count: number;
  declare consumed: boolean;
}

CancellationVerificationModel.init({
  user_id: { type: DataTypes.INTEGER, primaryKey: true, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
  appointment_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "appointment", key: "id" }, onDelete: "CASCADE" },
  challenge_id: { type: DataTypes.UUID, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false },
  code_hash: { type: DataTypes.STRING(64), allowNull: false },
  salt: { type: DataTypes.STRING(32), allowNull: false },
  attempts: { type: DataTypes.INTEGER, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  last_sent_at: { type: DataTypes.DATE, allowNull: false },
  window_started_at: { type: DataTypes.DATE, allowNull: false },
  send_count: { type: DataTypes.INTEGER, allowNull: false },
  consumed: { type: DataTypes.BOOLEAN, allowNull: false },
}, { sequelize, tableName: "cancellation_verification", underscored: true, timestamps: true });

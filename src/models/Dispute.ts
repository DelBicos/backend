import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export const DISPUTE_REASONS = [
  "service_not_done",
  "poor_quality",
  "wrong_charge",
  "wrong_no_show",
  "professional_absent",
  "other",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const DISPUTE_RESOLUTIONS = ["refund_full", "refund_partial", "rejected"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export interface IDispute {
  id?: number;
  appointment_id: number;
  opened_by_user_id: number;
  reason: DisputeReason;
  description: string;
  status: "open" | "resolved";
  resolution?: DisputeResolution | null;
  refund_cents?: number | null;
  resolution_note?: string | null;
  resolved_by_user_id?: number | null;
  resolved_at?: Date | null;
}

type DisputeCreationAttributes = Optional<
  IDispute,
  "id" | "status" | "resolution" | "refund_cents" | "resolution_note" | "resolved_by_user_id" | "resolved_at"
>;

/** Contestacao aberta pelo cliente sobre um atendimento; decidida por um admin. */
export class DisputeModel extends Model<IDispute, DisputeCreationAttributes> {
  public id!: number;
  public appointment_id!: number;
  public opened_by_user_id!: number;
  public reason!: DisputeReason;
  public description!: string;
  public status!: "open" | "resolved";
  public resolution?: DisputeResolution | null;
  public refund_cents?: number | null;
  public resolution_note?: string | null;
  public resolved_by_user_id?: number | null;
  public resolved_at?: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DisputeModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    appointment_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "appointment", key: "id" },
    },
    opened_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    reason: { type: DataTypes.STRING(40), allowNull: false },
    description: { type: DataTypes.STRING(1000), allowNull: false },
    status: {
      type: DataTypes.ENUM("open", "resolved"),
      allowNull: false,
      defaultValue: "open",
    },
    resolution: { type: DataTypes.STRING(20), allowNull: true },
    refund_cents: { type: DataTypes.INTEGER, allowNull: true },
    resolution_note: { type: DataTypes.STRING(1000), allowNull: true },
    resolved_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: "dispute",
    underscored: true,
    timestamps: true,
    indexes: [{ name: "idx_dispute_status", fields: ["status", "created_at"] }],
  },
);

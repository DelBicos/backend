import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export const DOCUMENT_TYPES = ["rg", "cnh"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const IDENTITY_STATUSES = ["pending", "approved", "rejected"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export interface IIdentityVerification {
  id?: number;
  professional_id: number;
  document_type: DocumentType;
  front_key?: string | null;
  back_key?: string | null;
  selfie_key?: string | null;
  status: IdentityStatus;
  reject_reason?: string | null;
  reviewed_by_user_id?: number | null;
  reviewed_at?: Date | null;
}

type CreationAttributes = Optional<
  IIdentityVerification,
  "id" | "status" | "front_key" | "back_key" | "selfie_key" | "reject_reason" | "reviewed_by_user_id" | "reviewed_at"
>;

/**
 * Pedido de verificacao de identidade de um profissional. Os arquivos ficam
 * em container privado e sao apagados assim que o administrador decide.
 */
export class IdentityVerificationModel extends Model<IIdentityVerification, CreationAttributes> {
  public id!: number;
  public professional_id!: number;
  public document_type!: DocumentType;
  public front_key!: string | null;
  public back_key!: string | null;
  public selfie_key!: string | null;
  public status!: IdentityStatus;
  public reject_reason!: string | null;
  public reviewed_by_user_id!: number | null;
  public reviewed_at!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

IdentityVerificationModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    professional_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "professional", key: "id" },
    },
    document_type: { type: DataTypes.STRING(10), allowNull: false },
    front_key: { type: DataTypes.STRING(255), allowNull: true },
    back_key: { type: DataTypes.STRING(255), allowNull: true },
    selfie_key: { type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "pending" },
    reject_reason: { type: DataTypes.STRING(500), allowNull: true },
    reviewed_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: "identity_verification",
    underscored: true,
    timestamps: true,
  },
);

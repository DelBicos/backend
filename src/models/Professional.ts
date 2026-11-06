import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

/*
CREATE TABLE professional (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    main_address_id INT,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    cnpj VARCHAR(18) UNIQUE,
    description STRING(1500),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (main_address_id) REFERENCES address(id),
)
*/

export interface IProfessional {
  id?: number;
  user_id: number;
  main_address_id?: number;
  cpf: string;
  cnpj?: string;
  description?: string;
  service_radius_km?: number;
  cancellations_count?: number;
  identity_verified_at?: Date | null;
}

type ProfessionalCreationalAttributes = Optional<
  IProfessional,
  "id" | "main_address_id" | "cnpj" | "description" | "identity_verified_at"
>;

export class ProfessionalModel extends Model<
  IProfessional,
  ProfessionalCreationalAttributes
> {
  public id!: number;
  public user_id!: number;
  public main_address_id?: number;
  public cpf!: string;
  public cnpj?: string;
  public description?: string;
  public service_radius_km?: number;
  public cancellations_count!: number;
  public identity_verified_at!: Date | null;

  // Timestamps
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ProfessionalModel.init(
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
      references: {
        model: "users",
        key: "id",
      },
    },
    main_address_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "address",
        key: "id",
      },
    },
    cpf: {
      type: DataTypes.STRING(14),
      allowNull: false,
      unique: true,
    },
    cnpj: {
      type: DataTypes.STRING(18),
      allowNull: true,
      unique: true,
    },
    description: {
      type: DataTypes.STRING(1500),
      allowNull: true,
    },
    cancellations_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    identity_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    service_radius_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "professional",
    underscored: true,
    timestamps: true,
  },
);

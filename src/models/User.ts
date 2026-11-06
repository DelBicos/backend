import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

/*
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(13) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    avatar_uri VARCHAR(255),
    banner_uri VARCHAR(255),
    INDEX active_index_users (active)
);
*/

export interface IUser {
  id?: number;
  name: string;
  email: string;
  phone: string;
  password: string;
  active?: boolean;
  avatar_uri?: string;
  banner_uri?: string;
  mfa_enabled?: boolean;
}

type UserCreationalAttributes = Optional<
  IUser,
  "id" | "active" | "avatar_uri" | "banner_uri" | "mfa_enabled"
>;

export class UserModel extends Model<IUser, UserCreationalAttributes> {
  public id!: number;
  public name!: string;
  public email!: string;
  public phone!: string;
  public password!: string;
  public active?: boolean;
  public avatar_uri?: string;
  public banner_uri?: string;
  public mfa_enabled?: boolean;

  // Timestamps
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING(13),
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    avatar_uri: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    banner_uri: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    mfa_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: "User",
    tableName: "users",
    underscored: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_users_active",
        fields: ["active"],
      },
    ],
  }
);

import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateShortId = customAlphabet(alphabet, 6);

/*
CREATE TABLE appointment (
    id INT AUTO_INCREMENT PRIMARY KEY,
    short_id CHAR(6) NOT NULL UNIQUE,
    professional_id INT NOT NULL,
    client_id INT NOT NULL,
    service_id INT NOT NULL,
    address_id INT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status ENUM('pending', 'confirmed', 'completed', 'canceled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (professional_id) REFERENCES professional(id),
    FOREIGN KEY (client_id) REFERENCES client(id),
    FOREIGN KEY (service_id) REFERENCES service(id),
    FOREIGN KEY (address_id) REFERENCES address(id),
    rating INT CHECK (rating BETWEEN 1 AND 5),
    review STRING(1000),
    INDEX idx_appointment_times (professional_id, start_time, end_time),
    INDEX idx_status_check (status, start_time)
) 
*/

export interface IAppointment {
  id?: number;
  short_id: string;
  professional_id: number;
  client_id: number;
  service_id: number;
  address_id: number;
  start_time: Date;
  end_time: Date;
  completed_at?: Date;
  final_price?: number;
  rating?: number;
  review?: string;
  status?: "pending" | "confirmed" | "completed" | "canceled";
  payment_intent_id?: string | null;
  createdAt?: Date;
}

type AppointmentCreationalAttributes = Optional<IAppointment, "id" | "status" | "short_id">;

export class AppointmentModel extends Model<
  IAppointment,
  AppointmentCreationalAttributes
> {
  public id!: number;
  public short_id!: string;
  public professional_id!: number;
  public client_id!: number;
  public service_id!: number;
  public address_id!: number;
  public start_time!: Date;
  public end_time!: Date;
  public completed_at?: Date;
  public final_price?: number;
  public rating?: number;
  public review?: string;
  public status!: "pending" | "confirmed" | "completed" | "canceled";
  public created_at!: Date;
  public payment_intent_id?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

AppointmentModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    short_id: {
      type: DataTypes.STRING(6),
      allowNull: false,
      unique: true
    },
    professional_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "professional",
        key: "id",
      },
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "client",
        key: "id",
      },
    },
    service_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "service",
        key: "id",
      },
    },
    address_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "address",
        key: "id",
      },
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: { min: 1, max: 5 },
    },
    review: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    final_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    start_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    end_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "confirmed", "completed", "canceled"),
      defaultValue: "pending",
    },
    payment_intent_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
  },
  {
    sequelize,
    tableName: "appointment",
    underscored: true,
    indexes: [
      {
        name: "idx_appointment_times",
        fields: ["professional_id", "start_time", "end_time"],
      },
      {
        name: "idx_status_check",
        fields: ["status", "start_time"],
      },
      {
        name: "idx_prof_status_completed_at",
        fields: ["professional_id", "status", "completed_at"],
      },
      {
        name: "idx_appointment_short_id",
        fields: ["short_id"],
      }
    ],
    timestamps: true,
    hooks: {
      beforeCreate: async (appointment: AppointmentModel) => {
        let shortId: string;
        let attempts = 0;
        let unique = false;
        while (!unique) {
          shortId = generateShortId();
          attempts++;
          if (attempts > 100) {
            throw new Error('Não foi possível gerar short_id único após 100 tentativas');
          }
          const existing = await AppointmentModel.findOne({ where: { short_id: shortId } });
          if (!existing) {
            appointment.short_id = shortId;
            unique = true;
          }
        }
      }
    }
  }
);

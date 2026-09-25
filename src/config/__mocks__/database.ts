/**
 * Mock manual de config/database para testes unitarios.
 * Evita abrir conexoes reais com Postgres/MongoDB ao importar models.
 * Uso: jest.mock("<caminho>/config/database");
 */
import mongoose from "mongoose";
import { Sequelize } from "sequelize";

export const sequelize = new Sequelize({ dialect: "postgres", logging: false });

export const chatMongoConnection = mongoose.createConnection();

export const isChatMongoReady = jest.fn(() => false);
export const connectDatabase = jest.fn(async () => undefined);
export const connectMongo = jest.fn(async () => undefined);

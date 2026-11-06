import dotenv from "dotenv";
dotenv.config();

import winston from "winston";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";

// Inicializar Logtail se token estiver configurado
const environment = process.env.ENVIRONMENT || "development";
const shouldEnableLogtail =
  environment !== "development" || process.env.ENABLE_LOGTAIL === "true";

const logtail =
  shouldEnableLogtail && process.env.LOGTAIL_TOKEN
    ? new Logtail(process.env.LOGTAIL_TOKEN)
    : null;

// Configuração de formato personalizado
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ["message", "level", "timestamp", "label"],
  }),
  winston.format.json(),
);

// Formato para console (desenvolvimento)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, metadata }) => {
    let metaStr = "";
    if (metadata && Object.keys(metadata).length > 0) {
      metaStr = `\n${JSON.stringify(metadata, null, 2)}`;
    }
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  }),
);

// Configurar transports
const transports: winston.transport[] = [
  // Console para desenvolvimento
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.ENVIRONMENT === "production" ? "info" : "debug",
  }),
];

// Adicionar Logtail transport se configurado
if (logtail) {
  transports.push(new LogtailTransport(logtail));
}

// No Azure App Service o stdout/stderr do Console transport ja vai para o
// Log Stream e para o Application Insights (configurado no proprio App Service).

// Criar logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: customFormat,
  transports,
  exitOnError: false,
});

// Adicionar métodos auxiliares para logging contextual
export const logRequest = (
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  userId?: number,
  error?: string,
) => {
  const logData = {
    type: "request",
    method,
    url,
    statusCode,
    duration: `${duration}ms`,
    userId,
    error,
  };

  if (statusCode >= 500) {
    logger.error("Request error", logData);
  } else if (statusCode >= 400) {
    logger.warn("Request warning", logData);
  } else {
    logger.info("Request completed", logData);
  }
};

export const logAuth = (
  action: string,
  userId?: number,
  email?: string,
  success: boolean = true,
  reason?: string,
) => {
  const logData = {
    type: "authentication",
    action,
    userId,
    email,
    success,
    reason,
  };

  if (success) {
    logger.info(`Auth: ${action}`, logData);
  } else {
    logger.warn(`Auth failed: ${action}`, logData);
  }
};

export const logDatabase = (
  operation: string,
  table: string,
  recordId?: number,
  error?: string,
) => {
  const logData = {
    type: "database",
    operation,
    table,
    recordId,
    error,
  };

  if (error) {
    logger.error(`DB error: ${operation} on ${table}`, logData);
  } else {
    logger.debug(`DB: ${operation} on ${table}`, logData);
  }
};

export const logError = (
  message: string,
  error: Error | unknown,
  context?: Record<string, unknown>,
) => {
  const errorData = {
    type: "error",
    message,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  };

  logger.error(message, errorData);
};

export default logger;

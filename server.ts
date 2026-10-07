import "./src/config/loadEnv";
import http from "http";
import logger from "./src/utils/logger";
import { assertRequiredEnv } from "./src/config/env";
import { connectDatabase, connectMongo } from "./src/config/database";
import { initializeAssociations } from "./src/models/associations";
import { startAppointmentCron } from "./src/jobs/appointmentCron";
import { initChatSocket } from "./src/realtime/chatSocket";
import { createApp } from "./src/app";

// Falha rapido se faltar configuracao obrigatoria (ex.: SECRET_KEY).
for (const warning of assertRequiredEnv()) logger.warn(warning);

logger.info("Variáveis de ambiente carregadas com sucesso");
logger.info(`Ambiente: ${process.env.ENVIRONMENT}`);

initializeAssociations();
void connectMongo();
void connectDatabase();

startAppointmentCron();
logger.info("Cron jobs iniciados");

const app = createApp();

const isServerless = process.env.IS_SERVERLESS == "true";

if (!isServerless) {
  const port = Number(process.env.PORT || 3000);
  // Servidor HTTP compartilhado entre Express e socket.io (chat em tempo real)
  const httpServer = http.createServer(app);
  initChatSocket(httpServer);
  httpServer.listen(port, () => {
    logger.info(`Servidor rodando na porta ${port}`);
  });
} else {
  logger.info("Servidor rodando em ambiente serverless");
}

export default app;

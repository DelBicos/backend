import express, { Express } from "express";
import http from "http";
import { setupCors } from "./src/middlewares/cors.middleware";
import { loggingMiddleware } from "./src/middlewares/logging.middleware";
import {
  helmetMiddleware,
  globalRateLimiter,
  authRateLimiter,
  hppMiddleware,
  mongoSanitizeMiddleware,
  xssSanitizer,
  sqlInjectionGuard,
} from "./src/middlewares/security.middleware";
import * as dotenv from "dotenv";
import logger from "./src/utils/logger";
import addressRoutes from "./src/routes/address.routes";
import categoryRoutes from "./src/routes/category.routes";
import subcategoryRoutes from "./src/routes/subcategory.routes";
import professionalRoutes from "./src/routes/professional.routes";
import appointmentRoutes from "./src/routes/appointment.routes";
import userRoutes from "./src/routes/user.routes";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import swaggerOptions from "./src/config/swagger";
import authRouter from "./src/routes/auth.routes";
import notificationRoutes from "./src/routes/notification.routes";
import path from "path";
import fs from "fs";
import { initializeAssociations } from "./src/models/associations";
import paymentRouter from "./src/routes/payment.routes";
import adminRoutes from "./src/routes/admin.routes";
import dashboardRoutes from "./src/routes/dashboard.routes";
import favoriteRoutes from "./src/routes/favorite.routes";
import avatarRouter from "./src/routes/avatar.routes";
import { startAppointmentCron } from "./src/jobs/appointmentCron";
import serviceRoutes from "./src/routes/service.routes";
import availabilityRoutes from "./src/routes/availability.routes";
import availabilityLockRoutes from "./src/routes/availabilityLock.routes";
import uploadRoutes from "./src/routes/upload.routes";
import proxyUploadRoutes from "./src/routes/proxyUpload.routes";
import chatRoutes from "./src/routes/chat.routes";
import emailRoutes from "./src/routes/email.routes";
import voiceRoutes from "./src/routes/voice.routes";
import { initChatSocket } from "./src/realtime/chatSocket";

dotenv.config({ override: false });

initializeAssociations();

logger.info("Variáveis de ambiente carregadas com sucesso");
logger.info(`Ambiente: ${process.env.ENVIRONMENT}`);

startAppointmentCron();
logger.info("Cron jobs iniciados");

const app: Express = express();
const swaggerSpec = swaggerJSDoc(swaggerOptions);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// // Helmet – protege contra ataques comuns com HTTP headers
// app.use(helmetMiddleware);

// // Rate limiting – protege contra brute-force e DDoS
// app.use(globalRateLimiter);

// // HPP – protege contra HTTP Parameter Pollution
// app.use(hppMiddleware);

// // Mongo Sanitize – protege contra NoSQL injection
// app.use(mongoSanitizeMiddleware);

// // XSS Sanitizer – escapa HTML e scripts maliciosos
// app.use(xssSanitizer);

// // SQL Injection Guard – detecta e bloqueia SQL injection
// app.use(sqlInjectionGuard);

setupCors(app);

// Middleware de logging de requisições
app.use(loggingMiddleware);

app.use(express.json());
const baseDir =
  process.env.ENVIRONMENT === "production" ? process.cwd() : __dirname;
const AVATAR_BUCKET_PATH = path.resolve(baseDir, "avatarBucket");
if (!fs.existsSync(AVATAR_BUCKET_PATH)) {
  fs.mkdirSync(AVATAR_BUCKET_PATH, { recursive: true });
}

app.use("/docs", swaggerUi.serve as any, swaggerUi.setup(swaggerSpec) as any);

app.use("/avatarBucket", express.static(AVATAR_BUCKET_PATH));

// Rotas
app.use("/api/user", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/subcategories", subcategoryRoutes);
app.use("/api/professionals", professionalRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentRouter);
app.use("/auth", authRateLimiter, authRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/avatar", avatarRouter);
app.use("/api/services", serviceRoutes);
app.use("/api/availabilities", availabilityRoutes);
app.use("/api/availability-locks", availabilityLockRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/proxy-upload", proxyUploadRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/utilities", emailRoutes);

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

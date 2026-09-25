import express, { Express } from "express";
import path from "path";
import fs from "fs";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import swaggerOptions from "./config/swagger";
import { setupCors } from "./middlewares/cors.middleware";
import { loggingMiddleware } from "./middlewares/logging.middleware";
import {
  helmetMiddleware,
  globalRateLimiter,
  authRateLimiter,
  loginRateLimiter,
  hppMiddleware,
  mongoSanitizeMiddleware,
} from "./middlewares/security.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import addressRoutes from "./routes/address.routes";
import categoryRoutes from "./routes/category.routes";
import subcategoryRoutes from "./routes/subcategory.routes";
import professionalRoutes from "./routes/professional.routes";
import appointmentRoutes from "./routes/appointment.routes";
import userRoutes from "./routes/user.routes";
import authRouter from "./routes/auth.routes";
import notificationRoutes from "./routes/notification.routes";
import paymentRouter from "./routes/payment.routes";
import adminRoutes from "./routes/admin.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import favoriteRoutes from "./routes/favorite.routes";
import avatarRouter from "./routes/avatar.routes";
import serviceRoutes from "./routes/service.routes";
import availabilityRoutes from "./routes/availability.routes";
import availabilityLockRoutes from "./routes/availabilityLock.routes";
import uploadRoutes from "./routes/upload.routes";
import proxyUploadRoutes from "./routes/proxyUpload.routes";
import chatRoutes from "./routes/chat.routes";
import emailRoutes from "./routes/email.routes";
import voiceRoutes from "./routes/voice.routes";

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "2mb";

/**
 * Monta a aplicacao Express (middlewares, rotas e tratamento de erros)
 * sem abrir porta, para ser reutilizada pelo servidor HTTP e por testes.
 */
export function createApp(): Express {
  const app = express();

  // Atras do proxy do Azure App Service / Render: usa o IP real do cliente
  // (X-Forwarded-For) no rate limit, em vez do IP do balanceador.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable("x-powered-by");

  // Seguranca
  app.use(helmetMiddleware);
  setupCors(app);
  app.use(globalRateLimiter);

  // Parsing
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: JSON_BODY_LIMIT, extended: true }));
  app.use(hppMiddleware);
  app.use(mongoSanitizeMiddleware);

  app.use(loggingMiddleware);

  // Documentacao e arquivos estaticos
  const swaggerSpec = swaggerJSDoc(swaggerOptions);
  app.use("/docs", swaggerUi.serve as any, swaggerUi.setup(swaggerSpec) as any);

  const baseDir =
    process.env.ENVIRONMENT === "production" ? process.cwd() : path.resolve(__dirname, "..");
  const avatarBucketPath = path.resolve(baseDir, "avatarBucket");
  if (!fs.existsSync(avatarBucketPath)) {
    fs.mkdirSync(avatarBucketPath, { recursive: true });
  }
  app.use("/avatarBucket", express.static(avatarBucketPath));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Rotas
  app.use("/api/user/login", loginRateLimiter);
  app.use("/api/admin/login", loginRateLimiter);
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

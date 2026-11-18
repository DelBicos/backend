import { Router } from "express";
import rateLimit from "express-rate-limit";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getService,
  updateService,
  deleteService,
  listAllServices,
  searchServicesSemantically,
  createServiceSelf,
  listMyServices,
} from "../controllers/service.controller";
import {
  validateCreateServiceTopLevel,
  validateUpdateService,
} from "../middlewares/service.validation";
import { sseHandler } from "../utils/sse";

const router = Router();
const isProduction = (process.env.ENVIRONMENT || process.env.NODE_ENV) === "production";

const semanticSearchRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 60 : 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas buscas semânticas. Aguarde alguns minutos antes de tentar novamente." },
});

router.get("/events", sseHandler("services"));

/**
 * @route GET /api/services/search/semantic?q=...
 * @desc Busca serviços por significado e retorna serviço + profissional.
 */
router.get("/search/semantic", semanticSearchRateLimit, searchServicesSemantically);

router.get("/", listAllServices);

router.get("/my", authMiddleware, listMyServices);

router.post(
  "/",
  authMiddleware,
  validateCreateServiceTopLevel,
  createServiceSelf,
);

router.get("/:id", getService);

router.put("/:id", authMiddleware, validateUpdateService, updateService);

router.delete("/:id", authMiddleware, deleteService);

export default router;

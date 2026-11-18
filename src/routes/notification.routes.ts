import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getNotificationsByUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  saveExpoPushToken,
} from "../controllers/notification.controller";

const router = Router();

// Todas as rotas exigem JWT; o :userId (mantido por compatibilidade com o
// app) precisa ser o do proprio usuario autenticado.
router.use(authMiddleware);

router.get("/:userId", getNotificationsByUser);
router.patch("/:notificationId/read/:userId", markNotificationAsRead);
router.patch("/mark-all-read/:userId", markAllNotificationsAsRead);
router.post("/notifications/save-token", saveExpoPushToken);

export default router;

import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getUserById,
  logInUser,
  changePassword,
  getUserByToken,
  updateUserProfile,
  getLocationConsent,
  acceptLocationConsent,
  revokeLocationConsent,
} from "../controllers/user.controller";

const router = Router();

router.post("/login", logInUser);

/**
 * Change password for authenticated user
 */
router.post("/change-password", authMiddleware, changePassword);

router.get("/me", authMiddleware, getUserByToken);
router.put("/me", authMiddleware, updateUserProfile);

// Consentimento LGPD do rastreamento de localizacao (antes de "/:id")
router.get("/location-consent", authMiddleware, getLocationConsent);
router.post("/location-consent", authMiddleware, acceptLocationConsent);
router.post("/revoke-location-consent", authMiddleware, revokeLocationConsent);

router.get("/:id", authMiddleware, getUserById);

export default router;

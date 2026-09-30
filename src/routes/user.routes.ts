import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getUserById,
  logInUser,
  changePassword,
  getUserByToken,
  updateUserProfile,
} from "../controllers/user.controller";

const router = Router();

router.post("/login", logInUser);

/**
 * Change password for authenticated user
 */
router.post("/change-password", authMiddleware, changePassword);

router.get("/me", authMiddleware, getUserByToken);
router.put("/me", authMiddleware, updateUserProfile);

router.get("/:id", authMiddleware, getUserById);

export default router;

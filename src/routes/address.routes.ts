import express from "express";
import {
  getAllAddressByUserId,
  getAddressesForAuthenticatedUser,
  createAddressForAuthenticatedUser,
  updateAddressForAuthenticatedUser,
  deleteAddressForAuthenticatedUser,
} from "../controllers/address.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = express.Router();

// Legado: prefira GET /session. Exige JWT e :userId igual ao do token.
router.get("/user/:userId", authMiddleware, getAllAddressByUserId);

// Authenticated endpoints for the logged-in user
router.get("/session", authMiddleware, getAddressesForAuthenticatedUser);

router.post("/session", authMiddleware, createAddressForAuthenticatedUser);
router.put("/session/:id", authMiddleware, updateAddressForAuthenticatedUser);

router.delete(
  "/session/:id",
  authMiddleware,
  deleteAddressForAuthenticatedUser
);

export default router;

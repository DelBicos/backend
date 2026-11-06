import { Router } from "express";
import {
  getAllAppointments,
  completeAppointment,
  confirmAppointment,
  reviewAppointment,
  getAppointmentInvoice,
  updateAppointmentStatus,
  createAppointment,
  previewCancellation,
  cancelAppointment,
  markNoShow,
  requestReschedule,
  listRescheduleSlots,
  respondToReschedule,
  openDispute,
  getDispute,
} from "../controllers/appointment.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();

router.post("/", authMiddleware, createAppointment);

router.get("/user/:id", authMiddleware, getAllAppointments);

router.post("/:id/confirm", authMiddleware, confirmAppointment);

router.post("/:id/complete", authMiddleware, completeAppointment);

router.get("/:id/cancellation-preview", authMiddleware, previewCancellation);

router.post("/:id/cancel", authMiddleware, cancelAppointment);

router.post("/:id/no-show", authMiddleware, markNoShow);

router.get("/:id/reschedule-slots", authMiddleware, listRescheduleSlots);

router.post("/:id/reschedule", authMiddleware, requestReschedule);

router.post("/:id/reschedule/respond", authMiddleware, respondToReschedule);

router.post("/:id/dispute", authMiddleware, openDispute);
router.get("/:id/dispute", authMiddleware, getDispute);

router.put("/:id", authMiddleware, updateAppointmentStatus);

router.post("/:id/review", authMiddleware, reviewAppointment);

router.get("/:id/receipt", authMiddleware, getAppointmentInvoice);

export default router;

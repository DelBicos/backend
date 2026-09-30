import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as NotificationService from "../services/notification/notification.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

export const getNotificationsByUser = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const userId = requireUserId(req);
    NotificationService.assertSameUser(userId, req.params.userId);
    res.json(await NotificationService.listNotifications(userId));
  },
);

export const markNotificationAsRead = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const userId = requireUserId(req);
    NotificationService.assertSameUser(userId, req.params.userId);
    res.json(await NotificationService.markAsRead(userId, req.params.notificationId));
  },
);

export const markAllNotificationsAsRead = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const userId = requireUserId(req);
    NotificationService.assertSameUser(userId, req.params.userId);
    const updatedCount = await NotificationService.markAllAsRead(userId);
    res.json({
      message: `${updatedCount} notifications marked as read.`,
      updatedCount,
    });
  },
);

/** O token de push e sempre associado ao usuario do JWT (userId do corpo e ignorado). */
export const saveExpoPushToken = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    await NotificationService.savePushToken(requireUserId(req), req.body?.token);
    res.status(201).json({ message: "Expo Push Token saved successfully." });
  },
);

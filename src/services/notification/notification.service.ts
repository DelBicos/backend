/**
 * Notificacoes in-app do usuario e registro do token de push (Expo).
 * Toda operacao atua apenas sobre o usuario autenticado.
 */
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { NotificationModel } from "../../models/Notification";
import { UserTokenModel } from "../../models/UserToken";
import { HttpError } from "../../errors/HttpError";
import logger from "../../utils/logger";

const expo = new Expo();

/** Rotas legadas recebem o userId na URL; ele precisa ser o do token. */
export function assertSameUser(authUserId: number, requestedUserId: unknown): void {
  if (requestedUserId !== undefined && Number(requestedUserId) !== authUserId) {
    throw HttpError.forbidden("Você só pode acessar as suas próprias notificações");
  }
}

export async function listNotifications(userId: number) {
  return NotificationModel.findAll({
    where: { user_id: userId },
    order: [
      ["is_read", "ASC"],
      ["createdAt", "DESC"],
    ],
  });
}

export async function markAsRead(userId: number, notificationId: unknown) {
  const id = Number(notificationId);
  const notification = Number.isInteger(id) ? await NotificationModel.findByPk(id) : null;
  if (!notification || notification.user_id !== userId) {
    throw HttpError.notFound("Notification not found.");
  }
  if (!notification.is_read) {
    notification.is_read = true;
    await notification.save();
  }
  return notification;
}

export async function markAllAsRead(userId: number) {
  const [updatedCount] = await NotificationModel.update(
    { is_read: true },
    { where: { user_id: userId, is_read: false } },
  );
  return updatedCount;
}

export async function savePushToken(userId: number, token: unknown) {
  if (typeof token !== "string" || !Expo.isExpoPushToken(token)) {
    throw HttpError.badRequest("Invalid Expo Push Token format.");
  }
  await UserTokenModel.upsert({ user_id: userId, token });
}

/** Envia push para o dispositivo registrado do usuario (se houver). */
export async function sendPushNotification(
  userId: number,
  title: string,
  message: string,
  notificationId: number,
): Promise<void> {
  try {
    const userToken = await UserTokenModel.findOne({ where: { user_id: userId } });
    if (!userToken || !Expo.isExpoPushToken(userToken.token)) return;

    const pushMessage: ExpoPushMessage = {
      to: userToken.token,
      sound: "default",
      title,
      body: message,
      data: { id: notificationId, title, message, createdAt: new Date().toISOString() },
    };
    await expo.sendPushNotificationsAsync([pushMessage]);
  } catch (error) {
    logger.warn("Falha ao enviar notificação push", {
      userId,
      reason: (error as Error).message,
    });
  }
}

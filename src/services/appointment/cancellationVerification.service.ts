import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { Transaction } from "sequelize";
import { sequelize } from "../../config/database";
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import { NotificationModel } from "../../models/Notification";
import { CancellationVerificationModel } from "../../models/CancellationVerification";
import { sendCancellationCode } from "../email/cancellationEmail.service";
import { withProfessionalScheduleLock } from "../appointmentSchedule.service";
import { enqueueAppointmentRefund } from "../appointmentRefund.service";
import { syncChatRoomStatusForAppointment } from "../../utils/chatRoom";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import logger from "../../utils/logger";

export class CancellationVerificationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

async function authorize(userId: number, appointment: AppointmentModel | null, transaction?: Transaction) {
  if (!appointment) throw new CancellationVerificationError("Agendamento não encontrado", 404);
  const client = await ClientModel.findByPk(appointment.client_id, { transaction });
  const professional = await ProfessionalModel.findByPk(appointment.professional_id, { transaction });
  const isClient = client?.user_id === userId;
  if (!isClient && professional?.user_id !== userId)
    throw new CancellationVerificationError("Agendamento não encontrado", 404);
  if (appointment.status === "canceled" || appointment.status === "completed")
    throw new CancellationVerificationError("Este agendamento não pode mais ser cancelado", 409);
  // Mantém a regra existente: a recusa do profissional só vale para pedidos pendentes.
  if (!isClient && appointment.status !== "pending")
    throw new CancellationVerificationError("Só é possível recusar um agendamento pendente", 409);
  if (!client || !professional) throw new CancellationVerificationError("Participantes não encontrados", 409);
  return { appointment, isClient, recipientId: isClient ? professional.user_id : client.user_id };
}

export async function resolveCancellationAppointment(reference: string): Promise<number> {
  const byCode = await AppointmentModel.findOne({ where: { short_id: reference.replace(/^#/, "").toUpperCase() } });
  if (byCode) return byCode.id;
  if (/^[1-9]\d*$/.test(reference) && Number.isSafeInteger(Number(reference))) return Number(reference);
  throw new CancellationVerificationError("Agendamento não encontrado", 404);
}

export async function requestCancellationCode(userId: number, appointmentId: number) {
  return sequelize.transaction(async (transaction) => {
    // Serializa pedidos por usuário, inclusive em múltiplas instâncias do backend.
    const user = await UserModel.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user?.active || !user.email) throw new CancellationVerificationError("Conta indisponível", 403);
    await authorize(userId, await AppointmentModel.findByPk(appointmentId, { transaction }), transaction);
    const previous = await CancellationVerificationModel.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const now = Date.now();
    const sameWindow = previous && now - previous.window_started_at.getTime() < 60 * 60 * 1000;
    if (previous && now - previous.last_sent_at.getTime() < 60_000)
      throw new CancellationVerificationError("Aguarde 60 segundos antes de pedir outro código", 429);
    if (sameWindow && previous.send_count >= 5)
      throw new CancellationVerificationError("Limite de envios atingido. Tente novamente em uma hora", 429);
    if (previous && previous.attempts >= 5 && previous.expires_at.getTime() > now)
      throw new CancellationVerificationError("Limite de tentativas atingido. Aguarde o código expirar", 429);
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(16).toString("hex");
    const values = {
      user_id: userId, appointment_id: appointmentId, challenge_id: randomUUID(), email: user.email,
      code_hash: scryptSync(code, salt, 32).toString("hex"), salt,
      // Reenviar não zera as tentativas de um desafio ativo.
      attempts: previous && !previous.consumed && previous.expires_at.getTime() > now ? previous.attempts : 0,
      expires_at: new Date(now + 600_000),
      last_sent_at: new Date(now), window_started_at: sameWindow ? previous.window_started_at : new Date(now),
      send_count: sameWindow ? previous.send_count + 1 : 1, consumed: false,
    };
    if (previous) await previous.update(values, { transaction });
    else await CancellationVerificationModel.create(values, { transaction });
    // Falha de envio reverte o desafio. Nunca cancela a reserva nesta etapa.
    await sendCancellationCode(user.email, code);
    const [name, domain] = user.email.split("@");
    return { challengeId: values.challenge_id, email: `${name.slice(0, 1)}***@${domain}`, expiresAt: values.expires_at.toISOString(), resendAfterSeconds: 60 };
  });
}

export async function abandonCancellationCode(userId: number, appointmentId: number, challengeId: string) {
  await CancellationVerificationModel.update({ consumed: true }, {
    where: { user_id: userId, appointment_id: appointmentId, challenge_id: challengeId },
  });
}

export async function confirmCancellationCode(userId: number, appointmentId: number, challengeId: string, code: string) {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code))
    throw new CancellationVerificationError("Informe o código de seis dígitos enviado ao seu e-mail");
  const original = await AppointmentModel.findByPk(appointmentId);
  await authorize(userId, original);
  const result = await withProfessionalScheduleLock(original!.professional_id, async (transaction) => {
    const { appointment, isClient, recipientId } = await authorize(userId,
      await AppointmentModel.findByPk(appointmentId, { transaction, lock: transaction.LOCK.UPDATE }), transaction);
    const verification = await CancellationVerificationModel.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const user = await UserModel.findByPk(userId, { transaction });
    if (!verification || verification.appointment_id !== appointmentId || verification.challenge_id !== challengeId ||
        verification.consumed || !user?.active || verification.email !== user.email || verification.expires_at.getTime() <= Date.now())
      return new CancellationVerificationError("Código expirado ou inválido. Solicite um novo código");
    if (verification.attempts >= 5)
      return new CancellationVerificationError("Limite de tentativas atingido. Aguarde o código expirar", 429);
    const valid = timingSafeEqual(scryptSync(code, verification.salt, 32), Buffer.from(verification.code_hash, "hex"));
    verification.attempts += 1;
    if (!valid) {
      await verification.save({ transaction });
      // Retorna o erro para fora da transação para preservar a contagem de tentativas.
      return new CancellationVerificationError("Código incorreto. Confira o e-mail e tente novamente");
    }
    appointment.status = "canceled";
    await appointment.save({ transaction });
    if (!isClient) await enqueueAppointmentRefund(appointment, transaction);
    await NotificationModel.create({ user_id: recipientId, title: "Agendamento cancelado",
      message: `${isClient ? "O cliente" : "O profissional"} cancelou o agendamento #${appointment.short_id}.`,
      notification_type: "appointment", related_entity_id: appointment.id, is_read: false }, { transaction });
    verification.consumed = true;
    await verification.save({ transaction });
    return appointment;
  });
  if (result instanceof CancellationVerificationError) throw result;
  try {
    await syncChatRoomStatusForAppointment(result.id, "canceled");
    await syncBotSessionsForAppointmentStatus(result);
  } catch { logger.warn("Cancelamento confirmado; falha ao sincronizar chats", { appointmentId }); }
  return result;
}

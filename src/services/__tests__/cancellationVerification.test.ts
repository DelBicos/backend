import { scryptSync } from "crypto";
jest.mock("../../config/database", () => ({ sequelize: { transaction: jest.fn() } }));
jest.mock("../../models/Appointment", () => ({ AppointmentModel: { findByPk: jest.fn(), findOne: jest.fn() } }));
jest.mock("../../models/Client", () => ({ ClientModel: { findByPk: jest.fn() } }));
jest.mock("../../models/Professional", () => ({ ProfessionalModel: { findByPk: jest.fn() } }));
jest.mock("../../models/User", () => ({ UserModel: { findByPk: jest.fn() } }));
jest.mock("../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("../../models/CancellationVerification", () => ({ CancellationVerificationModel: { findByPk: jest.fn(), create: jest.fn(), update: jest.fn() } }));
jest.mock("../email/cancellationEmail.service", () => ({ sendCancellationCode: jest.fn() }));
jest.mock("../appointmentSchedule.service", () => ({ withProfessionalScheduleLock: jest.fn() }));
jest.mock("../appointmentRefund.service", () => ({ enqueueAppointmentRefund: jest.fn() }));
jest.mock("../../utils/chatRoom", () => ({ syncChatRoomStatusForAppointment: jest.fn() }));
jest.mock("../botAppointmentStatus.service", () => ({ syncBotSessionsForAppointmentStatus: jest.fn() }));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { warn: jest.fn() } }));
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
import { requestCancellationCode, confirmCancellationCode, abandonCancellationCode, resolveCancellationAppointment } from "../appointment/cancellationVerification.service";

const challengeId = "12345678-1234-1234-1234-123456789012";
it("ID numérico da tela não é confundido com código curto de outra reserva", async () => {
  (AppointmentModel.findOne as jest.Mock).mockResolvedValue({ id: 999 });
  await expect(resolveCancellationAppointment("123456")).resolves.toBe(123456);
  expect(AppointmentModel.findOne).not.toHaveBeenCalled();
  await expect(resolveCancellationAppointment("#123456")).resolves.toBe(999);
});
const transaction = { LOCK: { UPDATE: "UPDATE" } };
const appointment = { id: 92, short_id: "A7F3", client_id: 6, professional_id: 1, status: "pending", save: jest.fn() };
const verification = {
  appointment_id: 92, challenge_id: challengeId, email: "client@example.com", consumed: false,
  salt: "salt", code_hash: scryptSync("123456", "salt", 32).toString("hex"), attempts: 0,
  expires_at: new Date(), last_sent_at: new Date(), window_started_at: new Date(), send_count: 1,
  save: jest.fn(), update: jest.fn(),
};
beforeEach(() => {
  jest.resetAllMocks();
  appointment.status = "pending";
  Object.assign(verification, { consumed: false, attempts: 0, appointment_id: 92, email: "client@example.com",
    challenge_id: challengeId, expires_at: new Date(Date.now() + 600000), last_sent_at: new Date(Date.now() - 61000),
    window_started_at: new Date(), send_count: 1 });
  (sequelize.transaction as jest.Mock).mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(transaction));
  (withProfessionalScheduleLock as jest.Mock).mockImplementation(async (_id: number, work: (t: unknown) => Promise<unknown>) => work(transaction));
  (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment);
  (ClientModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 6 });
  (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 10 });
  (UserModel.findByPk as jest.Mock).mockResolvedValue({ active: true, email: "client@example.com" });
  (CancellationVerificationModel.findByPk as jest.Mock).mockResolvedValue(verification);
});

it("envia código aleatório, armazena somente hash e mantém reserva ativa", async () => {
  const result = await requestCancellationCode(6, 92);
  const [email, code] = (sendCancellationCode as jest.Mock).mock.calls[0] as [string, string];
  const values = verification.update.mock.calls[0][0] as { code_hash: string; salt: string };
  expect(email).toBe("client@example.com");
  expect(code).toMatch(/^\d{6}$/);
  expect(values.code_hash).toBe(scryptSync(code, values.salt, 32).toString("hex"));
  expect(JSON.stringify(result)).not.toContain(code);
  expect(result.email).toBe("c***@example.com");
  expect(appointment.save).not.toHaveBeenCalled();
});
it("propaga falha de envio para rollback da transação sem cancelar", async () => {
  (sendCancellationCode as jest.Mock).mockRejectedValue(new Error("unavailable"));
  await expect(requestCancellationCode(6, 92)).rejects.toThrow("unavailable");
  expect(appointment.save).not.toHaveBeenCalled();
  expect(NotificationModel.create).not.toHaveBeenCalled();
});
it.each(["cooldown", "hourly", "attempts"])("limita envio: %s", async (kind) => {
  if (kind === "cooldown") verification.last_sent_at = new Date();
  if (kind === "hourly") verification.send_count = 5;
  if (kind === "attempts") verification.attempts = 5;
  await expect(requestCancellationCode(6, 92)).rejects.toMatchObject({ status: 429 });
  expect(sendCancellationCode).not.toHaveBeenCalled();
});
it("reenviar mantém tentativas e substitui desafio", async () => {
  verification.attempts = 3;
  await requestCancellationCode(6, 92);
  expect(verification.update).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3, challenge_id: expect.not.stringMatching(challengeId) }), { transaction });
});
it.each([6, 10])("cancela pelo participante %s e notifica a outra parte atomicamente", async (userId) => {
  await confirmCancellationCode(userId, 92, challengeId, "123456");
  expect(appointment.status).toBe("canceled");
  expect(appointment.save).toHaveBeenCalledWith({ transaction });
  expect(NotificationModel.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: userId === 6 ? 10 : 6 }), { transaction });
  expect(verification.consumed).toBe(true);
  expect(verification.save).toHaveBeenCalledWith({ transaction });
  expect(enqueueAppointmentRefund).toHaveBeenCalledTimes(userId === 10 ? 1 : 0);
  await expect(confirmCancellationCode(userId, 92, challengeId, "123456")).rejects.toMatchObject({ status: 409 });
  expect(NotificationModel.create).toHaveBeenCalledTimes(1);
});
it("persiste tentativas erradas e bloqueia a sexta tentativa mesmo correta", async () => {
  for (let i = 0; i < 5; i++) await expect(confirmCancellationCode(6, 92, challengeId, "654321")).rejects.toThrow("incorreto");
  expect(verification.attempts).toBe(5);
  expect(verification.save).toHaveBeenCalledTimes(5);
  await expect(confirmCancellationCode(6, 92, challengeId, "123456")).rejects.toMatchObject({ status: 429 });
  expect(appointment.save).not.toHaveBeenCalled();
});
it.each(["expired", "consumed", "other-appointment", "email-changed", "old-challenge"])("rejeita desafio %s", async (kind) => {
  if (kind === "expired") verification.expires_at = new Date(Date.now() - 1);
  if (kind === "consumed") verification.consumed = true;
  if (kind === "other-appointment") verification.appointment_id = 99;
  if (kind === "email-changed") verification.email = "changed@example.com";
  if (kind === "old-challenge") verification.challenge_id = "other";
  await expect(confirmCancellationCode(6, 92, challengeId, "123456")).rejects.toThrow("expirado ou inválido");
  expect(appointment.save).not.toHaveBeenCalled();
});
it("nega acesso a terceiros antes de enviar e antes de validar", async () => {
  await expect(requestCancellationCode(99, 92)).rejects.toMatchObject({ status: 404 });
  await expect(confirmCancellationCode(99, 92, challengeId, "123456")).rejects.toMatchObject({ status: 404 });
  expect(sendCancellationCode).not.toHaveBeenCalled();
  expect(appointment.save).not.toHaveBeenCalled();
});
it("desistência invalida somente o desafio do próprio participante", async () => {
  await abandonCancellationCode(6, 92, challengeId);
  expect(CancellationVerificationModel.update).toHaveBeenCalledWith({ consumed: true }, { where: { user_id: 6, appointment_id: 92, challenge_id: challengeId } });
});
it("falha de notificação rejeita a transação e não consome o desafio", async () => {
  (NotificationModel.create as jest.Mock).mockRejectedValue(new Error("notification unavailable"));
  await expect(confirmCancellationCode(6, 92, challengeId, "123456")).rejects.toThrow("notification unavailable");
  expect(verification.consumed).toBe(false);
});

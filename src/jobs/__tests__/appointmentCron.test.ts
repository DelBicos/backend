jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../../models/Appointment", () => ({ AppointmentModel: { findAll: jest.fn() } }));
jest.mock("../../models/Client", () => ({ ClientModel: {} }));
jest.mock("../../models/Professional", () => ({ ProfessionalModel: {} }));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));
jest.mock("../../utils/chatRoom", () => ({ archiveChatRoomForAppointment: jest.fn() }));
jest.mock("../../services/botAppointmentStatus.service", () => ({ syncBotSessionsForAppointmentStatus: jest.fn() }));
jest.mock("../../services/appointmentSchedule.service", () => ({ expirePendingAppointment: jest.fn() }));
jest.mock("../../services/appointmentRefund.service", () => ({ processAppointmentRefunds: jest.fn() }));
import cron from "node-cron";
import { AppointmentModel } from "../../models/Appointment";
import { NotificationModel } from "../../models/Notification";
import { expirePendingAppointment } from "../../services/appointmentSchedule.service";
import { processAppointmentRefunds } from "../../services/appointmentRefund.service";
import { startAppointmentCron } from "../appointmentCron";

let run: () => Promise<void>;
beforeEach(() => {
  jest.resetAllMocks();
  startAppointmentCron();
  run = (cron.schedule as jest.Mock).mock.calls[0][1];
  (expirePendingAppointment as jest.Mock).mockResolvedValue(true);
});

it("processa estornos antigos mesmo sem novas expirações", async () => {
  (AppointmentModel.findAll as jest.Mock).mockResolvedValue([]);
  await run();
  expect(processAppointmentRefunds).toHaveBeenCalledTimes(1);
});
it("não bloqueia a fila de estornos se a consulta de expirações falhar", async () => {
  (AppointmentModel.findAll as jest.Mock).mockRejectedValue(new Error("consulta falhou"));
  await run();
  expect(processAppointmentRefunds).toHaveBeenCalledTimes(1);
});
it("continua outras reservas e estornos quando uma notificação falha", async () => {
  const first = { id: 1, payment_intent_id: "pi_paid", Client: { User: { id: 3 } } };
  const second = { id: 2 };
  (AppointmentModel.findAll as jest.Mock).mockResolvedValue([first, second]);
  (NotificationModel.create as jest.Mock).mockRejectedValueOnce(new Error("push indisponível"));
  await run();
  expect(expirePendingAppointment).toHaveBeenCalledTimes(2);
  expect(processAppointmentRefunds).toHaveBeenCalledTimes(1);
  expect(NotificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining("estorno do pagamento será processado"),
  }));
});

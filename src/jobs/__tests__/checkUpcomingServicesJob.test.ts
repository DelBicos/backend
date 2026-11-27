jest.mock("../../config/database");
jest.mock("../../models/Appointment");
jest.mock("../../models/Professional");
jest.mock("../../models/Client");
jest.mock("../../models/User");
jest.mock("../../models/Service");
jest.mock("../../models/Notification");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { Op } from "sequelize";
import { AppointmentModel } from "../../models/Appointment";
import { NotificationModel } from "../../models/Notification";
import logger, { logError } from "../../utils/logger";
import { checkUpcomingServices, startUpcomingServicesJob } from "../checkUpcomingServicesJob";

const mocked = (fn: unknown) => fn as jest.Mock;
const NOW = new Date("2030-01-10T12:00:00.000Z");

const makeAppt = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  Professional: { User: { id: 2, name: "Bruno" } },
  Client: { User: { id: 1, name: "Ana" } },
  Service: { title: "Corte" },
  ...overrides,
});

const created = () =>
  mocked(NotificationModel.create).mock.calls.map(([p]) => p as Record<string, unknown>);

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  mocked(AppointmentModel.findAll).mockResolvedValue([]);
  mocked(NotificationModel.findOne).mockResolvedValue(null);
  mocked(NotificationModel.create).mockResolvedValue({});
});

describe("checkUpcomingServices", () => {
  it("busca agendamentos confirmados de agora ate 75 minutos", async () => {
    await expect(checkUpcomingServices()).resolves.toBe(0);

    const [query] = mocked(AppointmentModel.findAll).mock.calls[0];
    expect(query.where).toEqual({
      status: "confirmed",
      start_time: { [Op.between]: [NOW, new Date(NOW.getTime() + 75 * 60 * 1000)] },
    });
  });

  it("avisa profissional e cliente e conta o agendamento", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([makeAppt()]);

    await expect(checkUpcomingServices()).resolves.toBe(1);

    expect(NotificationModel.findOne).toHaveBeenCalledWith({
      where: { user_id: 2, title: "Serviço em 1 Hora! ⏰", related_entity_id: 10 },
    });
    expect(created()).toEqual([
      expect.objectContaining({
        user_id: 2,
        title: "Serviço em 1 Hora! ⏰",
        message: "Daqui a 1 hora você tem o serviço 'Corte' com Ana. Se prepare!",
        notification_type: "appointment",
        related_entity_id: 10,
        is_read: false,
      }),
      expect.objectContaining({
        user_id: 1,
        title: "Lembrete de Serviço ⏰",
        message: "Seu agendamento para o serviço 'Corte' com Bruno é daqui a 1 hora!",
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith("Notificação de 1h enviada para o agendamento", {
      appointmentId: 10,
    });
  });

  it("usa textos padrao quando faltam nomes e servico e avisa so o profissional sem cliente", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([
      makeAppt({ Professional: { User: { id: 2 } }, Client: undefined, Service: undefined }),
    ]);

    await expect(checkUpcomingServices()).resolves.toBe(1);

    expect(created()).toHaveLength(1);
    expect(created()[0].message).toBe(
      "Daqui a 1 hora você tem o serviço 'Agendado' com Cliente. Se prepare!",
    );
  });

  it("usa nome padrao do profissional na mensagem ao cliente", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([
      makeAppt({ Professional: { User: { id: 2 } } }),
    ]);

    await checkUpcomingServices();

    expect(created()[1].message).toBe(
      "Seu agendamento para o serviço 'Corte' com Profissional é daqui a 1 hora!",
    );
  });

  it("pula agendamento sem usuario do profissional", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([makeAppt({ Professional: undefined })]);

    await expect(checkUpcomingServices()).resolves.toBe(0);
    expect(NotificationModel.findOne).not.toHaveBeenCalled();
  });

  it("nao repete o aviso ja enviado", async () => {
    mocked(AppointmentModel.findAll).mockResolvedValue([makeAppt(), makeAppt({ id: 11 })]);
    mocked(NotificationModel.findOne).mockResolvedValueOnce({ id: 99 }).mockResolvedValueOnce(null);

    await expect(checkUpcomingServices()).resolves.toBe(1);
    expect(created().every((p) => p.related_entity_id === 11)).toBe(true);
  });

  it("registra o erro e devolve zero quando a consulta falha", async () => {
    const error = new Error("db fora");
    mocked(AppointmentModel.findAll).mockRejectedValue(error);

    await expect(checkUpcomingServices()).resolves.toBe(0);
    expect(logError).toHaveBeenCalledWith("Erro ao verificar agendamentos próximos de 1 hora", error);
  });
});

describe("startUpcomingServicesJob", () => {
  it("roda na hora e depois a cada intervalo", async () => {
    const timer = startUpcomingServicesJob(1000);

    expect(AppointmentModel.findAll).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(AppointmentModel.findAll).toHaveBeenCalledTimes(3);

    clearInterval(timer);
  });

  it("usa intervalo padrao de 5 minutos", async () => {
    const timer = startUpcomingServicesJob();

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(AppointmentModel.findAll).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(AppointmentModel.findAll).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });
});

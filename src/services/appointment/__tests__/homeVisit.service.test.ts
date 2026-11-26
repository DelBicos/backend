jest.mock("../../../config/database");
jest.mock("../../../models/Address");
jest.mock("../../../models/Client");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Service");
jest.mock("../../../models/User");
jest.mock("../appointment.service", () => ({
  findAppointmentByPublicId: jest.fn(),
  toPublicAppointment: jest.fn(() => ({ public: true })),
}));
jest.mock("../checkin.service", () => ({
  canUserAccessAuditTrail: jest.fn(),
  ensureVerificationCode: jest.fn(),
  fetchAppointmentAuditTrail: jest.fn(),
  processAppointmentArrived: jest.fn(),
  processAppointmentCheckin: jest.fn(),
  processAppointmentCheckout: jest.fn(),
  processAppointmentInTransit: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { HttpError } from "../../../errors/HttpError";
import { findAppointmentByPublicId, toPublicAppointment } from "../appointment.service";
import * as checkin from "../checkin.service";
import * as visit from "../homeVisit.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const STARTED = new Date("2030-01-10T12:00:00.000Z");

const appointment = {
  id: 10,
  short_id: "ABC123",
  Client: { user_id: 1 },
  Professional: { user_id: 2 },
};

const expectHttpError = async (promise: Promise<unknown>, status: number, message?: string) => {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as HttpError;
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
  if (message) expect(error.message).toBe(message);
  return error;
};

beforeEach(() => {
  mocked(findAppointmentByPublicId).mockResolvedValue(appointment);
});

describe("carregamento do agendamento", () => {
  it("busca pelo id publico com cliente, profissional, servico e endereco", async () => {
    await visit.getVisitDetails(1, "ABC123");

    const [publicId, options] = mocked(findAppointmentByPublicId).mock.calls[0];
    expect(publicId).toBe("ABC123");
    expect(
      (options as { include: Array<{ as: string }> }).include.map((i) => i.as),
    ).toEqual(["Client", "Professional", "Service", "Address"]);
  });

  it("responde 404 quando o agendamento nao existe", async () => {
    mocked(findAppointmentByPublicId).mockResolvedValue(null);
    await expectHttpError(visit.getVisitDetails(1, "X"), 404, "Agendamento não encontrado");
  });
});

describe("getVisitDetails", () => {
  it.each([
    ["cliente", 1],
    ["profissional", 2],
  ])("devolve os detalhes para o %s", async (_label, userId) => {
    await expect(visit.getVisitDetails(userId, "ABC123")).resolves.toEqual({ public: true });
    expect(toPublicAppointment).toHaveBeenCalledWith(appointment, userId);
  });

  it("nega acesso a terceiros", async () => {
    await expectHttpError(visit.getVisitDetails(3, "ABC123"), 403);
  });

  it("nega acesso quando o agendamento nao tem partes carregadas", async () => {
    mocked(findAppointmentByPublicId).mockResolvedValue({ id: 10 });
    await expectHttpError(visit.getVisitDetails(1, "ABC123"), 403);
  });
});

describe("markInTransit", () => {
  it("garante o codigo e atualiza o status", async () => {
    mocked(checkin.processAppointmentInTransit).mockResolvedValue({ success: true, appointment });

    await expect(visit.markInTransit(2, "ABC123")).resolves.toEqual({
      message: "Status atualizado para em deslocamento.",
      appointment: { public: true },
    });
    expect(checkin.ensureVerificationCode).toHaveBeenCalledWith(appointment);
    expect(checkin.processAppointmentInTransit).toHaveBeenCalledWith(appointment, 2);
  });

  it.each([
    [403, "Sem permissão"],
    [400, "Transição inválida"],
  ])("traduz a falha %s das regras", async (status, error) => {
    mocked(checkin.processAppointmentInTransit).mockResolvedValue({ success: false, status, error });
    await expectHttpError(visit.markInTransit(2, "ABC123"), status, error);
  });
});

describe("markArrived", () => {
  it("aceita coordenadas em texto e nao devolve o codigo ao profissional", async () => {
    mocked(checkin.processAppointmentArrived).mockResolvedValue({ success: true, code: "1234" });

    const result = await visit.markArrived(2, "ABC123", { latitude: "-23.5", longitude: -46.6 });

    expect(result).toEqual({ message: "Chegada confirmada. Peça o código ao cliente." });
    expect(checkin.processAppointmentArrived).toHaveBeenCalledWith(appointment, 2, -23.5, -46.6);
  });

  it.each([
    ["latitude ausente", { longitude: 1 }, "latitude"],
    ["latitude nao numerica", { latitude: "abc", longitude: 1 }, "latitude"],
    ["longitude infinita", { latitude: 1, longitude: Infinity }, "longitude"],
    ["longitude booleana", { latitude: 1, longitude: true }, "longitude"],
  ])("recusa %s antes de buscar o agendamento", async (_label, body, field) => {
    await expectHttpError(
      visit.markArrived(2, "ABC123", body),
      400,
      `O campo '${field}' é obrigatório e deve ser numérico`,
    );
    expect(findAppointmentByPublicId).not.toHaveBeenCalled();
  });

  it("devolve a distancia quando o profissional esta longe demais", async () => {
    mocked(checkin.processAppointmentArrived).mockResolvedValue({
      success: false,
      status: 400,
      error: "Longe demais",
      distance: 900,
      maxDistance: 300,
    });

    const error = await expectHttpError(
      visit.markArrived(2, "ABC123", { latitude: 1, longitude: 2 }),
      400,
      "Longe demais",
    );
    expect(error.details).toEqual({ distance: 900, maxDistance: 300 });
  });
});

describe("startService", () => {
  it("inicia com o codigo informado", async () => {
    mocked(checkin.processAppointmentCheckin).mockResolvedValue({ success: true, startedAt: STARTED });

    await expect(visit.startService(2, "ABC123", "1234")).resolves.toEqual({
      message: "Atendimento iniciado.",
      started_at: STARTED,
    });
    expect(checkin.processAppointmentCheckin).toHaveBeenCalledWith(appointment, 2, "1234");
  });

  it("ignora codigo que nao e texto", async () => {
    mocked(checkin.processAppointmentCheckin).mockResolvedValue({ success: true, startedAt: STARTED });
    await visit.startService(2, "ABC123", 1234);
    expect(checkin.processAppointmentCheckin).toHaveBeenCalledWith(appointment, 2, undefined);
  });

  it("traduz conflito em 409", async () => {
    mocked(checkin.processAppointmentCheckin).mockResolvedValue({
      success: false,
      status: 409,
      error: "Já iniciado",
    });
    await expectHttpError(visit.startService(2, "ABC123", "1234"), 409, "Já iniciado");
  });
});

describe("completeService", () => {
  it("conclui com o codigo informado", async () => {
    mocked(checkin.processAppointmentCheckout).mockResolvedValue({ success: true, completedAt: STARTED });

    await expect(visit.completeService(2, "ABC123", "9999")).resolves.toEqual({
      message: "Atendimento concluído.",
      completed_at: STARTED,
    });
  });

  it("traduz codigo errado em 400", async () => {
    mocked(checkin.processAppointmentCheckout).mockResolvedValue({
      success: false,
      status: 400,
      error: "Código inválido",
    });
    await expectHttpError(visit.completeService(2, "ABC123", "0000"), 400, "Código inválido");
  });
});

describe("getAuditTrail", () => {
  it("devolve os logs para quem tem acesso", async () => {
    mocked(checkin.canUserAccessAuditTrail).mockResolvedValue(true);
    mocked(checkin.fetchAppointmentAuditTrail).mockResolvedValue([{ id: 1 }]);

    await expect(visit.getAuditTrail(5, "ABC123", true)).resolves.toEqual({
      appointment_id: "ABC123",
      logs: [{ id: 1 }],
    });
    expect(checkin.canUserAccessAuditTrail).toHaveBeenCalledWith(appointment, 5, true);
    expect(checkin.fetchAppointmentAuditTrail).toHaveBeenCalledWith(10);
  });

  it("nega acesso sem permissao", async () => {
    mocked(checkin.canUserAccessAuditTrail).mockResolvedValue(false);
    await expectHttpError(
      visit.getAuditTrail(5, "ABC123", false),
      403,
      "Acesso negado à trilha de auditoria",
    );
    expect(checkin.fetchAppointmentAuditTrail).not.toHaveBeenCalled();
  });
});

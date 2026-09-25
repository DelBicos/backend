import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Appointment");
jest.mock("../../../models/User");
jest.mock("../../../models/Client");
jest.mock("../../../models/Professional");
jest.mock("../../../models/Service");
jest.mock("../../../models/Address");
jest.mock("../../../models/Subcategory");
jest.mock("../../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn(),
  syncChatRoomStatusForAppointment: jest.fn(),
}));
jest.mock("../../botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn(),
}));
jest.mock("../../payment.service", () => ({
  PaymentService: { refundPaymentIntent: jest.fn() },
}));
jest.mock("../appointment.notifications", () => ({
  formatAppointmentDate: jest.fn(() => "01/10/2026"),
  formatAppointmentTime: jest.fn(() => "10:00"),
  notifyAppointmentCreated: jest.fn(),
  notifyAppointmentAccepted: jest.fn(),
  notifyAppointmentCompleted: jest.fn(),
  notifyAppointmentRejected: jest.fn(),
  notifyReviewReceived: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { AddressModel } from "../../../models/Address";
import { UserModel } from "../../../models/User";
import { PaymentService } from "../../payment.service";
import * as notifications from "../appointment.notifications";
import * as service from "../appointment.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const futureStart = () => {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  d.setHours(10, 0, 0, 0);
  return d;
};

const makeAppointment = (overrides: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = {
    id: 10,
    short_id: "ABC123",
    status: "pending",
    professional_id: 20,
    client_id: 30,
    service_id: 40,
    payment_intent_id: null,
    rating: null,
    start_time: futureStart(),
    end_time: futureStart(),
    ...overrides,
  };
  return {
    ...data,
    save: jest.fn(),
    toJSON: () => ({ ...data }),
  } as any;
};

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

beforeEach(() => jest.clearAllMocks());

describe("findAppointmentByPublicId", () => {
  it("busca pelo short_id em maiusculas", async () => {
    const appt = makeAppointment();
    mocked(AppointmentModel.findOne).mockResolvedValue(appt);
    await expect(service.findAppointmentByPublicId("abc123")).resolves.toBe(appt);
    expect(mocked(AppointmentModel.findOne).mock.calls[0][0].where).toEqual({
      short_id: "ABC123",
    });
  });

  it("usa a chave numerica como fallback", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mocked(AppointmentModel.findByPk).mockResolvedValue(makeAppointment());
    await service.findAppointmentByPublicId("10");
    expect(AppointmentModel.findByPk).toHaveBeenCalledWith(10, {});
  });

  it("nao consulta pk para ids nao numericos", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    await expect(service.findAppointmentByPublicId("ZZZ999")).resolves.toBeNull();
    expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
  });
});

describe("listAppointmentsForUser", () => {
  it("proibe listar agendamentos de outro usuario (IDOR)", async () => {
    await expectHttpError(service.listAppointmentsForUser(1, "2"), 403);
    expect(AppointmentModel.findAll).not.toHaveBeenCalled();
  });

  it("retorna vazio quando o usuario nao tem perfil", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    await expect(service.listAppointmentsForUser(1, "1")).resolves.toEqual([]);
  });

  it("filtra pela visao de cliente e expoe short_id como id", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(ProfessionalModel.findOne).mockResolvedValue({ id: 20 });
    mocked(AppointmentModel.findAll).mockResolvedValue([makeAppointment()]);

    const result = await service.listAppointmentsForUser(1, "1", "client");

    expect(mocked(AppointmentModel.findAll).mock.calls[0][0].where).toEqual({
      client_id: 30,
    });
    expect(result[0].id).toBe("ABC123");
    expect(result[0].short_id).toBeUndefined();
    expect(result[0].payment_method).toBe("Cartão de Crédito");
  });
});

describe("respondToAppointment", () => {
  it("rejeita status invalido", async () => {
    await expectHttpError(service.respondToAppointment(1, "ABC123", "completed"), 400);
  });

  it("so o profissional responsavel pode responder", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(makeAppointment());
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 999 });
    await expectHttpError(service.respondToAppointment(1, "ABC123", "confirmed"), 403);
  });

  it("recusa estorna o pagamento e notifica o cliente", async () => {
    const appt = makeAppointment({
      payment_intent_id: "pi_1",
      Client: { user_id: 5 },
      Service: { title: "Limpeza" },
    });
    mocked(AppointmentModel.findOne).mockResolvedValue(appt);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    mocked(PaymentService.refundPaymentIntent).mockResolvedValue(true);

    await service.respondToAppointment(1, "ABC123", "canceled");

    expect(appt.status).toBe("canceled");
    expect(appt.save).toHaveBeenCalled();
    expect(PaymentService.refundPaymentIntent).toHaveBeenCalledWith("pi_1");
    expect(notifications.notifyAppointmentRejected).toHaveBeenCalledWith(
      5,
      "Limpeza",
      10,
      "refunded",
    );
  });

  it("nao altera agendamento que nao esta pendente", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({ status: "completed" }),
    );
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    await expectHttpError(service.respondToAppointment(1, "ABC123", "confirmed"), 400);
  });
});

describe("confirmAppointment", () => {
  it("confirma e notifica o cliente", async () => {
    const appt = makeAppointment();
    mocked(AppointmentModel.findOne).mockResolvedValue(appt);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    mocked(ClientModel.findByPk).mockResolvedValue({ user_id: 5 });
    mocked(ServiceModel.findByPk).mockResolvedValue({ title: "Limpeza" });

    await service.confirmAppointment(1, "ABC123");

    expect(appt.status).toBe("confirmed");
    expect(notifications.notifyAppointmentAccepted).toHaveBeenCalledWith(5, "Limpeza", 10);
  });

  it("retorna 404 para agendamento inexistente", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    await expectHttpError(service.confirmAppointment(1, "NOPE00"), 404);
  });
});

describe("completeAppointment", () => {
  const past = new Date(Date.now() - 2 * 3600_000);

  it("conclui, registra a data e notifica o cliente", async () => {
    const appt = makeAppointment({
      status: "confirmed",
      start_time: past,
      Client: { user_id: 5 },
      Service: { title: "Pintura" },
    });
    mocked(AppointmentModel.findOne).mockResolvedValue(appt);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    const now = new Date();

    await service.completeAppointment(1, "ABC123", now);

    expect(appt.status).toBe("completed");
    expect(appt.completed_at).toBe(now);
    expect(appt.save).toHaveBeenCalled();
    expect(notifications.notifyAppointmentCompleted).toHaveBeenCalledWith(5, "Pintura", 10);
  });

  it("somente o profissional responsavel pode concluir", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({ status: "confirmed", start_time: past }),
    );
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 99 });
    await expectHttpError(service.completeAppointment(1, "ABC123"), 403);
  });

  it("nao conclui pedidos que ainda nao foram confirmados", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({ status: "pending", start_time: past }),
    );
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    await expectHttpError(service.completeAppointment(1, "ABC123"), 400);
  });

  it("nao conclui antes do horario de inicio", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({ status: "confirmed" }),
    );
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    await expectHttpError(service.completeAppointment(1, "ABC123"), 400);
  });
});

describe("reviewAppointment", () => {
  it("somente o cliente do agendamento pode avaliar", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({ status: "completed", Client: { user_id: 7 } }),
    );
    await expectHttpError(
      service.reviewAppointment(1, "ABC123", { rating: 5, review: "" }),
      403,
    );
  });

  it("registra avaliacao e notifica o profissional na primeira vez", async () => {
    const appt = makeAppointment({ status: "completed", Client: { user_id: 1 } });
    mocked(AppointmentModel.findOne).mockResolvedValue(appt);
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ user_id: 2 });
    mocked(ServiceModel.findByPk).mockResolvedValue({ title: "Pintura" });

    const result = await service.reviewAppointment(1, "ABC123", {
      rating: 4,
      review: "Bom",
    });

    expect(result.message).toBe("Avaliação registrada com sucesso");
    expect(appt.rating).toBe(4);
    expect(notifications.notifyReviewReceived).toHaveBeenCalledWith(
      2,
      10,
      4,
      "Bom",
      "Pintura",
    );
  });
});

describe("getAppointmentInvoice", () => {
  it("nao retorna comprovante de agendamento de outro cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockResolvedValue(makeAppointment({ client_id: 31 }));
    await expectHttpError(service.getAppointmentInvoice(1, "ABC123"), 404);
  });

  it("aceita o short_id usado pelo app", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockResolvedValue(
      makeAppointment({
        createdAt: new Date(),
        Service: { title: "Limpeza", price: "150.00" },
      }),
    );

    const invoice = await service.getAppointmentInvoice(1, "ABC123");

    expect(invoice.invoiceNumber).toBe("NF000010");
    expect(invoice.total).toBe(150);
  });
});

describe("createAppointment", () => {
  const input = () => ({
    service_id: 40,
    professional_id: 20,
    address_id: 50,
    start_time: futureStart().toISOString(),
  });

  const arrangeValidBooking = () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30, user_id: 1 });
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 2 });
    mocked(ServiceModel.findByPk).mockResolvedValue({
      id: 40,
      active: true,
      professional_id: 20,
      duration: 60,
      title: "Limpeza",
    });
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 1 });
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mocked(UserModel.findByPk).mockResolvedValue({ id: 1, name: "Ana" });
  };

  it("exige os campos obrigatorios", async () => {
    await expectHttpError(
      service.createAppointment(1, { ...input(), address_id: undefined }),
      400,
    );
  });

  it("recusa servico de outro profissional", async () => {
    arrangeValidBooking();
    mocked(ServiceModel.findByPk).mockResolvedValue({
      id: 40,
      active: true,
      professional_id: 99,
      duration: 60,
    });
    await expectHttpError(service.createAppointment(1, input()), 400);
  });

  it("recusa endereco de outro usuario", async () => {
    arrangeValidBooking();
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 999 });
    await expectHttpError(service.createAppointment(1, input()), 404);
  });

  it("recusa agendar consigo mesmo", async () => {
    arrangeValidBooking();
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ id: 20, user_id: 1 });
    await expectHttpError(service.createAppointment(1, input()), 400);
  });

  it("recusa horario ja ocupado", async () => {
    arrangeValidBooking();
    mocked(AppointmentModel.findOne).mockResolvedValue(makeAppointment());
    await expectHttpError(service.createAppointment(1, input()), 409);
  });

  it("cria com termino calculado pela duracao do servico", async () => {
    arrangeValidBooking();
    mocked(AppointmentModel.create).mockImplementation(async (data: any) => ({
      id: 11,
      ...data,
    }));

    const created: any = await service.createAppointment(1, input());

    const expectedEnd = new Date(new Date(input().start_time).getTime() + 60 * 60_000);
    expect(created.end_time).toEqual(expectedEnd);
    expect(created.client_id).toBe(30);
    expect(notifications.notifyAppointmentCreated).toHaveBeenCalled();
  });
});

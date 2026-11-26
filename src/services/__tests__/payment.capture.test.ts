import { HttpError } from "../../errors/HttpError";

jest.mock("../../config/database");
jest.mock("../appointmentSchedule.service");
jest.mock("../appointmentRefund.service");
jest.mock("../../models/Appointment");
jest.mock("../../models/AppointmentRefund");
jest.mock("../../models/Client");
jest.mock("../../models/Service");
jest.mock("../../models/Address");
jest.mock("../../models/User");
jest.mock("../../models/Professional");
jest.mock("../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn(),
}));
jest.mock("../appointment/appointmentNotifications.service", () => ({
  notifyPaymentConfirmed: jest.fn(),
  notifyAppointmentCreated: jest.fn(),
}));
jest.mock("../appointment/appointment.service", () => ({
  validateBookingRequest: jest.fn(),
  assertProfessionalIsFree: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockPaymentIntentsCapture = jest.fn();
const mockPaymentIntentsCancel = jest.fn();
const mockRefundsCreate = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
      capture: mockPaymentIntentsCapture,
      cancel: mockPaymentIntentsCancel,
    },
    refunds: { create: mockRefundsCreate },
  })),
);

import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ServiceModel } from "../../models/Service";
import { AddressModel } from "../../models/Address";
import * as appointmentService from "../appointment/appointment.service";
import { PaymentService, servicePriceInCents } from "../payment.service";
import * as scheduleLock from "../appointmentSchedule.service";
import * as refundQueue from "../appointmentRefund.service";
import { AppointmentRefundModel } from "../../models/AppointmentRefund";
import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import { ensureChatRoomForAppointment } from "../../utils/chatRoom";
import logger from "../../utils/logger";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import * as notifications from "../appointment/appointmentNotifications.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

beforeEach(() => jest.clearAllMocks());

describe("servicePriceInCents", () => {
  it("usa price_cents quando existir", () => {
    expect(servicePriceInCents({ price: 10, price_cents: 1234 })).toBe(1234);
  });

  it("converte price decimal para centavos sem erro de arredondamento", () => {
    expect(servicePriceInCents({ price: "19.99" })).toBe(1999);
  });

  it("rejeita servico sem preco", () => {
    expect(() => servicePriceInCents({ price: 0 })).toThrow(HttpError);
  });
});

describe("createPaymentIntent", () => {
  it("cria o PaymentIntent e retorna o client_secret", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_123",
      client_secret: "pi_123_secret_456",
    });

    const secret = await PaymentService.createPaymentIntent({
      amount: 5000,
      currency: "brl",
      metadata: { orderId: "order_abc" },
    });

    expect(secret).toBe("pi_123_secret_456");
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: 5000,
      currency: "brl",
      automatic_payment_methods: { enabled: true },
      capture_method: "manual",
      metadata: { orderId: "order_abc" },
    });
  });

  it("propaga erro do Stripe com mensagem amigavel", async () => {
    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error("Stripe API error"));
    await expect(
      PaymentService.createPaymentIntent({ amount: 1000, currency: "usd" }),
    ).rejects.toThrow("Erro ao iniciar o processo de pagamento: Stripe API error");
  });
});

describe("createBookingPaymentIntent", () => {
  it("cobra o preco do servico (ignora valor do cliente) e vincula o usuario", async () => {
    mocked(appointmentService.validateBookingRequest).mockResolvedValue({
      service: { id: 40, price: "150.00" },
      professional: { id: 20 },
    });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "secret" });

    await PaymentService.createBookingPaymentIntent(1, {
      professionalId: 20,
      serviceId: 40,
      addressId: 50,
      selectedTime: "2030-01-10T13:00:00.000Z",
    });

    const args = mockPaymentIntentsCreate.mock.calls[0][0];
    expect(args.amount).toBe(15000);
    expect(args.currency).toBe("brl");
    expect(args.metadata.userId).toBe("1");
    expect(args.metadata.selectedTime).toBe("2030-01-10T13:00:00.000Z");
  });

  it("exige os dados do agendamento", async () => {
    await expectHttpError(
      PaymentService.createBookingPaymentIntent(1, {
        professionalId: 20,
        serviceId: 40,
        addressId: undefined,
        selectedTime: undefined,
      }),
      400,
    );
  });

  it("nao permite pagar agendamento de outro cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 9, client_id: 31 });
    await expectHttpError(
      PaymentService.createBookingPaymentIntent(1, {
        professionalId: 20,
        serviceId: 40,
        addressId: 50,
        selectedTime: "x",
        appointmentId: 9,
      }),
      404,
    );
  });

  it("nao permite pagar duas vezes o mesmo agendamento", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findByPk).mockResolvedValue({
      id: 9,
      client_id: 30,
      status: "pending",
      payment_intent_id: "pi_old",
    });
    await expectHttpError(
      PaymentService.createBookingPaymentIntent(1, {
        professionalId: 20,
        serviceId: 40,
        addressId: 50,
        selectedTime: "x",
        appointmentId: 9,
      }),
      409,
    );
  });

  it("paga agendamento pendente do chatbot usando o servico do agendamento", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findByPk).mockResolvedValue({
      id: 9,
      client_id: 30,
      status: "pending",
      payment_intent_id: null,
      service_id: 40,
      professional_id: 20,
      start_time: new Date("2030-01-10T13:00:00.000Z"),
    });
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 1 });
    mocked(ServiceModel.findByPk).mockResolvedValue({ id: 40, price_cents: 9900 });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "secret" });

    await PaymentService.createBookingPaymentIntent(1, {
      professionalId: 999,
      serviceId: 999,
      addressId: 50,
      selectedTime: "x",
      appointmentId: 9,
    });

    const args = mockPaymentIntentsCreate.mock.calls[0][0];
    expect(args.amount).toBe(9900);
    expect(args.metadata).toMatchObject({
      appointmentId: "9",
      serviceId: "40",
      professionalId: "20",
    });
  });

  it("aceita o identificador publico do app (short_id) e grava a chave numerica", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockResolvedValueOnce({
      id: 9,
      client_id: 30,
      status: "pending",
      payment_intent_id: null,
      service_id: 40,
      professional_id: 20,
      final_price: 120,
      start_time: new Date("2030-01-10T13:00:00.000Z"),
    });
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 1 });
    mocked(ServiceModel.findByPk).mockResolvedValue({ id: 40, price_cents: 9900 });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "secret" });

    await PaymentService.createBookingPaymentIntent(1, {
      professionalId: 20,
      serviceId: 40,
      addressId: 50,
      selectedTime: "x",
      appointmentId: "ab12cd",
    });

    expect(mocked(AppointmentModel.findOne).mock.calls[0][0]).toEqual({
      where: { short_id: "AB12CD" },
    });
    const args = mockPaymentIntentsCreate.mock.calls[0][0];
    // Reserva existente cobra o preco combinado nela.
    expect(args.amount).toBe(12000);
    expect(args.metadata.appointmentId).toBe("9");
  });
});

describe("confirmAndCreateAppointment", () => {
  const succeededIntent = (metadata: Record<string, string>) => ({
    id: "pi_1",
    status: "requires_capture",
    amount: 15000,
    metadata,
  });
  const activeService = (overrides: Record<string, unknown> = {}) => ({
    id: 40,
    professional_id: 20,
    active: true,
    duration: 90,
    title: "Pintura",
    price_cents: 15000,
    ...overrides,
  });

  const baseMetadata = {
    userId: "1",
    professionalId: "20",
    serviceId: "40",
    addressId: "50",
    selectedTime: "2030-01-10T13:00:00.000Z",
  };

  it("rejeita id de pagamento malformado", async () => {
    await expectHttpError(PaymentService.confirmAndCreateAppointment("abc", 1), 400);
  });

  it("impede confirmar pagamento de outro usuario", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mockPaymentIntentsRetrieve.mockResolvedValue(
      succeededIntent({ ...baseMetadata, userId: "2" }),
    );
    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 403);
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("e idempotente: devolve o agendamento ja vinculado ao pagamento", async () => {
    const existing = { id: 77, client_id: 30 };
    mocked(AppointmentModel.findOne).mockResolvedValue(existing);
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));

    await expect(PaymentService.confirmAndCreateAppointment("pi_1", 1)).resolves.toBe(existing);
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("recusa pagamento nao concluido", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mockPaymentIntentsRetrieve.mockResolvedValue({
      ...succeededIntent(baseMetadata),
      status: "requires_payment_method",
    });
    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 400);
  });

  it("cria o agendamento com termino pela duracao do servico", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(ServiceModel.findByPk).mockResolvedValue(activeService());
    mocked(AppointmentModel.create).mockImplementation(async (data: any) => ({
      id: 5,
      ...data,
    }));

    const appt: any = await PaymentService.confirmAndCreateAppointment("pi_1", 1);

    expect(appt.client_id).toBe(30);
    expect(appt.payment_intent_id).toBe("pi_1");
    expect(appt.end_time).toEqual(new Date("2030-01-10T14:30:00.000Z"));
    expect(appt.final_price).toBe(150);
    // A criacao acontece sob a trava da agenda do profissional.
    expect(scheduleLock.withProfessionalScheduleLock).toHaveBeenCalledWith(20, expect.any(Function));
  });

  it("enfileira a devolucao quando o valor nao bate com o servico", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mockPaymentIntentsRetrieve.mockResolvedValue({ ...succeededIntent(baseMetadata), amount: 100 });
    mocked(ServiceModel.findByPk).mockResolvedValue(activeService());

    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 422);
    expect(refundQueue.enqueuePaymentRefund).toHaveBeenCalledWith("pi_1", null, expect.anything());
    expect(refundQueue.settleQueuedPayment).toHaveBeenCalledWith("pi_1");
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("nao reaproveita um pagamento que ja esta na fila de devolucao", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentRefundModel.findOne).mockResolvedValueOnce({ id: 1 });
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));

    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 409);
    expect(refundQueue.enqueuePaymentRefund).not.toHaveBeenCalled();
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("libera a reserva quando o horario ficou ocupado antes da confirmacao", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(ServiceModel.findByPk).mockResolvedValue(activeService({ duration: 60 }));
    mocked(scheduleLock.assertNoAppointmentOverlap).mockRejectedValue(
      new scheduleLock.ScheduleConflictError("Horário ocupado."),
    );

    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 409);
    // A devolucao fica registrada no mesmo commit e e tentada logo em seguida.
    expect(refundQueue.enqueuePaymentRefund).toHaveBeenCalledWith("pi_1", null, expect.anything());
    expect(refundQueue.settleQueuedPayment).toHaveBeenCalledWith("pi_1");
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });
});

describe("capturePayment", () => {
  it("cobra o valor reservado", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture" });
    mockPaymentIntentsCapture.mockResolvedValue({});
    await PaymentService.capturePayment("pi_1");
    expect(mockPaymentIntentsCapture).toHaveBeenCalledWith("pi_1");
  });

  it("e idempotente quando ja foi cobrado", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    await PaymentService.capturePayment("pi_1");
    expect(mockPaymentIntentsCapture).not.toHaveBeenCalled();
  });

  it("falha com 409 se a reserva foi cancelada ou expirou", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "canceled" });
    await expectHttpError(PaymentService.capturePayment("pi_1"), 409);
    expect(mockPaymentIntentsCapture).not.toHaveBeenCalled();
  });

  it("falha com 409 se o Stripe recusar a captura", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture" });
    mockPaymentIntentsCapture.mockRejectedValue(new Error("expired"));
    await expectHttpError(PaymentService.capturePayment("pi_1"), 409);
  });
});

describe("settleUnusedPayment", () => {
  it("libera a reserva quando ainda nao foi cobrado", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture" });
    mockPaymentIntentsCancel.mockResolvedValue({});
    await expect(PaymentService.settleUnusedPayment("pi_1")).resolves.toBe("released");
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("estorna quando o valor ja foi cobrado", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    mockRefundsCreate.mockResolvedValue({});
    await expect(PaymentService.settleUnusedPayment("pi_1")).resolves.toBe("refunded");
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_1" });
  });

  it("nao faz nada se a reserva ja foi cancelada", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "canceled" });
    await expect(PaymentService.settleUnusedPayment("pi_1")).resolves.toBe("released");
    expect(mockPaymentIntentsCancel).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("retorna failed quando o Stripe der erro", async () => {
    mockPaymentIntentsRetrieve.mockRejectedValue(new Error("network"));
    await expect(PaymentService.settleUnusedPayment("pi_1")).resolves.toBe("failed");
  });
});

describe("settleWithRetention", () => {
  it("reservado + retencao parcial: captura so o valor retido", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture", amount: 10000 });
    mockPaymentIntentsCapture.mockResolvedValue({});
    const split = await PaymentService.settleWithRetention("pi_1", 20);
    expect(mockPaymentIntentsCapture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 2000 });
    expect(split).toEqual({ status: "ok", paidCents: 10000, retainedCents: 2000, refundedCents: 8000 });
  });

  it("reservado + 0%: libera tudo", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture", amount: 10000 });
    mockPaymentIntentsCancel.mockResolvedValue({});
    const split = await PaymentService.settleWithRetention("pi_1", 0);
    expect(mockPaymentIntentsCancel).toHaveBeenCalledWith("pi_1");
    expect(split.refundedCents).toBe(10000);
  });

  it("ja cobrado: estorna so a diferenca", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 10000 });
    mockRefundsCreate.mockResolvedValue({});
    const split = await PaymentService.settleWithRetention("pi_1", 30);
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_1", amount: 7000 });
    expect(split).toMatchObject({ retainedCents: 3000, refundedCents: 7000 });
  });

  it("ja cobrado + 100%: nao estorna nada", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 10000 });
    const split = await PaymentService.settleWithRetention("pi_1", 100);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(split).toMatchObject({ retainedCents: 10000, refundedCents: 0 });
  });

  it("reservado + 100%: captura o valor total", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture", amount: 10000 });
    mockPaymentIntentsCapture.mockResolvedValue({});
    await PaymentService.settleWithRetention("pi_1", 100);
    expect(mockPaymentIntentsCapture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 10000 });
  });

  it("retorna failed em erro do Stripe ou status inesperado", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "requires_payment_method", amount: 100 });
    await expect(PaymentService.settleWithRetention("pi_1", 0)).resolves.toMatchObject({ status: "failed" });
    mockPaymentIntentsRetrieve.mockRejectedValue(new Error("boom"));
    await expect(PaymentService.settleWithRetention("pi_1", 0)).resolves.toMatchObject({ status: "failed" });
  });
});

describe("refundAmount", () => {
  it("estorna o valor pedido", async () => {
    mockRefundsCreate.mockResolvedValue({});
    await expect(PaymentService.refundAmount("pi_1", 1234)).resolves.toBe(true);
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_1", amount: 1234 });
  });
  it("retorna false quando o Stripe falha", async () => {
    mockRefundsCreate.mockRejectedValue(new Error("x"));
    await expect(PaymentService.refundAmount("pi_1", 1)).resolves.toBe(false);
  });
});

describe("confirmAndCreateAppointment - reserva existente e efeitos", () => {
  const metadata = {
    userId: "1",
    professionalId: "20",
    serviceId: "40",
    addressId: "50",
    selectedTime: "2030-01-10T13:00:00.000Z",
  };
  const intent = (overrides: Record<string, unknown> = {}) => ({
    status: "requires_capture",
    amount: 15000,
    metadata,
    ...overrides,
  });
  const reservation = (overrides: Record<string, unknown> = {}) => ({
    id: 9,
    client_id: 30,
    professional_id: 20,
    service_id: 40,
    status: "pending",
    payment_intent_id: null,
    final_price: null,
    start_time: new Date(metadata.selectedTime),
    save: jest.fn(),
    ...overrides,
  });

  beforeEach(() => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockReset().mockResolvedValue(null);
    mocked(AppointmentRefundModel.findOne).mockResolvedValue(null);
    mocked(ServiceModel.findByPk).mockResolvedValue({
      id: 40,
      professional_id: 20,
      active: true,
      title: "Pintura",
      price_cents: 15000,
    });
    mocked(scheduleLock.assertNoAppointmentOverlap).mockReset().mockResolvedValue(undefined);
    mocked(AppointmentModel.create).mockImplementation(async (data: object) => ({ id: 5, ...data }));
    mocked(ensureChatRoomForAppointment).mockResolvedValue(undefined);
    mocked(syncBotSessionsForAppointmentStatus).mockResolvedValue(null);
    mocked(notifications.notifyAppointmentCreated).mockResolvedValue(undefined);
    mocked(notifications.notifyPaymentConfirmed).mockResolvedValue(undefined);
  });

  it("traduz falha do Stripe ao buscar o pagamento em 400", async () => {
    mockPaymentIntentsRetrieve.mockRejectedValue(new Error("No such payment_intent"));
    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 400);
  });

  it.each([
    ["sem metadados", undefined],
    ["com profissional invalido", { ...metadata, professionalId: "abc" }],
    ["com data invalida", { ...metadata, selectedTime: "ontem" }],
  ])("recusa pagamento %s com 422", async (_label, meta) => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent({ metadata: meta ?? { userId: "1" } }));
    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 422);
  });

  it("recusa pagamento ja vinculado a reserva de outro cliente", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent());
    mocked(AppointmentModel.findOne).mockResolvedValueOnce({ id: 77, client_id: 99 });
    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 403);
    expect(refundQueue.settleQueuedPayment).not.toHaveBeenCalled();
  });

  it("vincula o pagamento a reserva do chatbot e avisa o cliente", async () => {
    const existing = reservation();
    mockPaymentIntentsRetrieve.mockResolvedValue(intent({ metadata: { ...metadata, appointmentId: "9" } }));
    mocked(AppointmentModel.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

    await expect(PaymentService.confirmAndCreateAppointment("pi_1", 1)).resolves.toBe(existing);

    expect(existing).toMatchObject({ payment_intent_id: "pi_1", address_id: 50, final_price: 150 });
    expect(existing.save).toHaveBeenCalled();
    expect(AppointmentModel.create).not.toHaveBeenCalled();
    expect(ensureChatRoomForAppointment).not.toHaveBeenCalled();
    expect(notifications.notifyPaymentConfirmed).toHaveBeenCalledWith(1, 9, "Pintura", existing.start_time);
    expect(syncBotSessionsForAppointmentStatus).toHaveBeenCalledWith(existing);
  });

  it("confere o valor pelo preco combinado na reserva", async () => {
    const existing = reservation({ final_price: 120 });
    mockPaymentIntentsRetrieve.mockResolvedValue(
      intent({ amount: 12000, metadata: { ...metadata, appointmentId: "9" } }),
    );
    mocked(AppointmentModel.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

    await PaymentService.confirmAndCreateAppointment("pi_1", 1);
    expect(existing.final_price).toBe(120);
  });

  it.each([
    ["nao encontrada", null, 404, "APPOINTMENT_NOT_OWNED"],
    ["de outro servico", reservation({ service_id: 41 }), 409, "APPOINTMENT_MISMATCH"],
    ["ja paga", reservation({ payment_intent_id: "pi_old" }), 409, "APPOINTMENT_ALREADY_PAID"],
    ["cancelada", reservation({ status: "canceled" }), 409, "APPOINTMENT_NOT_PAYABLE"],
  ])("devolve o pagamento quando a reserva esta %s", async (_label, existing, status, code) => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent({ metadata: { ...metadata, appointmentId: "9" } }));
    mocked(AppointmentModel.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

    const error = await PaymentService.confirmAndCreateAppointment("pi_1", 1).catch((e: HttpError) => e);

    expect(error).toMatchObject({ status, code });
    expect(refundQueue.enqueuePaymentRefund).toHaveBeenCalledWith(
      "pi_1",
      existing ? 9 : null,
      expect.anything(),
    );
    expect(refundQueue.settleQueuedPayment).toHaveBeenCalledWith("pi_1");
  });

  it.each([
    ["inativo", { id: 40, professional_id: 20, active: false }],
    ["de outro profissional", { id: 40, professional_id: 21, active: true }],
  ])("devolve o pagamento quando o servico esta %s", async (_label, service) => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent());
    mocked(ServiceModel.findByPk).mockResolvedValue(service);

    const error = await PaymentService.confirmAndCreateAppointment("pi_1", 1).catch((e: HttpError) => e);
    expect(error).toMatchObject({ status: 409, code: "SERVICE_UNAVAILABLE" });
    expect(refundQueue.settleQueuedPayment).toHaveBeenCalledWith("pi_1");
  });

  it("propaga erro inesperado da checagem de agenda sem enfileirar devolucao", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent());
    mocked(scheduleLock.assertNoAppointmentOverlap).mockRejectedValue(new Error("db fora"));

    await expect(PaymentService.confirmAndCreateAppointment("pi_1", 1)).rejects.toThrow("db fora");
    expect(refundQueue.enqueuePaymentRefund).not.toHaveBeenCalled();
  });

  it("cria o chat e avisa as partes do novo agendamento", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent());
    mocked(ProfessionalModel.findByPk).mockResolvedValue({ user_id: 200 });
    mocked(UserModel.findByPk).mockResolvedValue({ id: 1, name: "Ana" });

    const appt = await PaymentService.confirmAndCreateAppointment("pi_1", 1);

    expect(ensureChatRoomForAppointment).toHaveBeenCalledWith(appt);
    expect(notifications.notifyAppointmentCreated).toHaveBeenCalledWith({
      appointmentId: 5,
      startTime: new Date(metadata.selectedTime),
      serviceTitle: "Pintura",
      clientUserId: 1,
      clientName: "Ana",
      professionalUserId: 200,
    });
  });

  it("nao desfaz o pagamento quando chat, aviso e chatbot falham", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(intent());
    mocked(ensureChatRoomForAppointment).mockRejectedValue(new Error("chat"));
    mocked(ProfessionalModel.findByPk).mockRejectedValue(new Error("aviso"));
    mocked(syncBotSessionsForAppointmentStatus).mockRejectedValue(new Error("bot"));

    await expect(PaymentService.confirmAndCreateAppointment("pi_1", 1)).resolves.toMatchObject({ id: 5 });

    const warnings = mocked(logger.warn).mock.calls.map(([msg]) => msg);
    expect(warnings).toEqual([
      "[PaymentService] Falha ao criar chat após confirmação",
      "[PaymentService] Falha ao notificar pagamento confirmado",
      "[PaymentService] Falha ao sincronizar status no chatbot",
    ]);
  });
});

describe("getAppointmentReceipt", () => {
  beforeEach(() => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockReset();
  });

  it("devolve o link do recibo do pagamento", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue({ id: 9, payment_intent_id: "pi_1" });
    mockPaymentIntentsRetrieve.mockResolvedValue({ latest_charge: { receipt_url: "https://recibo" } });

    await expect(PaymentService.getAppointmentReceipt(9, 1)).resolves.toBe("https://recibo");
    expect(AppointmentModel.findOne).toHaveBeenCalledWith({ where: { id: 9, client_id: 30 } });
    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] });
  });

  it("exige perfil de cliente", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    await expectHttpError(PaymentService.getAppointmentReceipt(9, 1), 403);
  });

  it.each([
    ["o agendamento nao e do cliente", null],
    ["nao houve pagamento online", { id: 9, payment_intent_id: null }],
  ])("responde 404 quando %s", async (_label, appointment) => {
    mocked(AppointmentModel.findOne).mockResolvedValue(appointment);
    await expectHttpError(PaymentService.getAppointmentReceipt(9, 1), 404);
  });

  it("responde 404 quando o Stripe ainda nao tem recibo", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue({ id: 9, payment_intent_id: "pi_1" });
    mockPaymentIntentsRetrieve.mockResolvedValue({ latest_charge: null });
    await expectHttpError(PaymentService.getAppointmentReceipt(9, 1), 404);
  });
});

describe("createBookingPaymentIntent - reserva existente", () => {
  const input = { professionalId: 20, serviceId: 40, addressId: 50, selectedTime: "x", appointmentId: "9" };

  beforeEach(() => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(AppointmentModel.findOne).mockReset().mockResolvedValue(null);
  });

  it("recusa reserva que nao esta mais pendente", async () => {
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 9, client_id: 30, status: "confirmed" });
    await expectHttpError(PaymentService.createBookingPaymentIntent(1, input), 400);
  });

  it("recusa endereco de outro usuario", async () => {
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 9, client_id: 30, status: "pending" });
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 2 });
    await expectHttpError(PaymentService.createBookingPaymentIntent(1, input), 404);
  });

  it("recusa endereco com id invalido sem consultar o banco", async () => {
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 9, client_id: 30, status: "pending" });
    await expectHttpError(
      PaymentService.createBookingPaymentIntent(1, { ...input, addressId: "abc" }),
      404,
    );
    expect(AddressModel.findByPk).not.toHaveBeenCalled();
  });

  it("responde 404 quando o servico da reserva sumiu", async () => {
    mocked(AppointmentModel.findByPk).mockResolvedValue({ id: 9, client_id: 30, status: "pending", service_id: 40 });
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 50, user_id: 1 });
    mocked(ServiceModel.findByPk).mockResolvedValue(null);
    await expectHttpError(PaymentService.createBookingPaymentIntent(1, input), 404);
  });
});

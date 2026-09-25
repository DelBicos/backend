import { HttpError } from "../../errors/HttpError";

jest.mock("../../config/database");
jest.mock("../../models/Appointment");
jest.mock("../../models/Client");
jest.mock("../../models/Service");
jest.mock("../../models/Address");
jest.mock("../../models/User");
jest.mock("../../models/Professional");
jest.mock("../../utils/chatRoom", () => ({ ensureChatRoomForAppointment: jest.fn() }));
jest.mock("../botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn(),
}));
jest.mock("../appointment/appointment.notifications", () => ({
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
const mockRefundsCreate = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
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
});

describe("confirmAndCreateAppointment", () => {
  const succeededIntent = (metadata: Record<string, string>) => ({
    id: "pi_1",
    status: "succeeded",
    metadata,
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
    const existing = { id: 77 };
    mocked(AppointmentModel.findOne).mockResolvedValue(existing);
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));

    await expect(PaymentService.confirmAndCreateAppointment("pi_1", 1)).resolves.toBe(existing);
    expect(AppointmentModel.create).not.toHaveBeenCalled();
  });

  it("recusa pagamento nao concluido", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
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
    mocked(ServiceModel.findByPk).mockResolvedValue({ id: 40, duration: 90, title: "Pintura" });
    mocked(AppointmentModel.create).mockImplementation(async (data: any) => ({
      id: 5,
      ...data,
    }));

    const appt: any = await PaymentService.confirmAndCreateAppointment("pi_1", 1);

    expect(appt.client_id).toBe(30);
    expect(appt.payment_intent_id).toBe("pi_1");
    expect(appt.end_time).toEqual(new Date("2030-01-10T14:30:00.000Z"));
  });

  it("estorna quando o horario ficou ocupado antes da confirmacao", async () => {
    mocked(AppointmentModel.findOne).mockResolvedValue(null);
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent(baseMetadata));
    mocked(ClientModel.findOne).mockResolvedValue({ id: 30 });
    mocked(ServiceModel.findByPk).mockResolvedValue({ id: 40, duration: 60 });
    mocked(appointmentService.assertProfessionalIsFree).mockRejectedValue(
      HttpError.conflict("Horário ocupado."),
    );
    mockRefundsCreate.mockResolvedValue({});

    await expectHttpError(PaymentService.confirmAndCreateAppointment("pi_1", 1), 409);
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_1" });
  });
});

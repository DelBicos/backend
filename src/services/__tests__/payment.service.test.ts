jest.mock("../../models/User", () => ({
  UserModel: { findByPk: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../models/Appointment", () => ({
  AppointmentModel: { create: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../../models/Notification", () => ({
  NotificationModel: { create: jest.fn() },
}));
jest.mock("../../models/Service", () => ({
  ServiceModel: { findByPk: jest.fn() },
}));
jest.mock("../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn().mockResolvedValue(undefined),
}));

import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { AppointmentModel } from "../../models/Appointment";
import { NotificationModel } from "../../models/Notification";
import { ServiceModel } from "../../models/Service";
import { ensureChatRoomForAppointment } from "../../utils/chatRoom";

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();

jest.doMock("stripe", () => {
  return jest.fn().mockImplementation(() => {
    return {
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        retrieve: mockPaymentIntentsRetrieve,
      },
      refunds: {
        create: mockRefundsCreate,
      },
    };
  });
});

// 3. Importe o SERVIÇO e o Stripe DEPOIS do doMock
//    Agora temos certeza que eles receberão a versão mockada.
let PaymentService: any;

beforeAll(() => {
  PaymentService = require("../payment.service").PaymentService;
});

// --- Fim do Mocking ---

describe("PaymentService", () => {
  beforeEach(() => {
    mockPaymentIntentsCreate.mockClear();
    mockPaymentIntentsRetrieve.mockClear();
    mockRefundsCreate.mockClear();
  });

  // --- Teste de SUCESSO ---
  it("should create a PaymentIntent and return a client_secret on success", async () => {
    // 1. Arrange
    const mockClientSecret = "pi_123_secret_456";
    const inputParams = {
      amount: 5000,
      currency: "brl",
      metadata: { orderId: "order_abc" },
    };

    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_123",
      client_secret: mockClientSecret,
    });

    // 2. Act
    const clientSecret = await PaymentService.createPaymentIntent(inputParams);

    // 3. Assert
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: inputParams.amount,
      currency: inputParams.currency,
      automatic_payment_methods: { enabled: true },
      metadata: inputParams.metadata,
    });
    expect(clientSecret).toBe(mockClientSecret);
  });

  // --- Teste de ERRO ---
  it("should throw an error if Stripe API fails", async () => {
    // 1. Arrange
    const errorMessage = "Stripe API error";
    const inputParams = {
      amount: 1000,
      currency: "usd",
    };

    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error(errorMessage));

    // 2. Act & Assert
    await expect(
      PaymentService.createPaymentIntent(inputParams)
    ).rejects.toThrow(
      `Erro ao iniciar o processo de pagamento: ${errorMessage}`
    );

    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: inputParams.amount,
      currency: inputParams.currency,
      automatic_payment_methods: { enabled: true },
      metadata: undefined,
    });
  });

  it("wraps a missing client_secret as a provider failure", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_123",
      client_secret: null,
    });

    await expect(
      PaymentService.createPaymentIntent({ amount: 1000, currency: "brl" }),
    ).rejects.toThrow(
      "Erro ao iniciar o processo de pagamento: Falha ao obter o identificador de pagamento do provedor.",
    );
  });

  const succeededIntent = {
    status: "succeeded",
    metadata: {
      professionalId: "2",
      serviceId: "3",
      selectedTime: "2026-05-01T10:00:00.000Z",
      addressId: "4",
    },
  };

  it("creates the appointment when the PaymentIntent succeeded", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(succeededIntent);
    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce({ id: 9 });
    (ClientModel.findOne as jest.Mock).mockResolvedValueOnce({ id: 8 });
    (AppointmentModel.create as jest.Mock).mockResolvedValueOnce({ id: 11 });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValueOnce({
      title: "Corte",
    });
    (NotificationModel.create as jest.Mock).mockResolvedValueOnce({});

    const appointment = await PaymentService.confirmAndCreateAppointment(
      "pi_123",
      9,
    );

    expect(appointment).toEqual({ id: 11 });
    expect(ensureChatRoomForAppointment).toHaveBeenCalledWith({ id: 11 });
    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 8, notification_type: "appointment" }),
    );
  });

  it("rejects a PaymentIntent that was not paid", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      status: "requires_payment_method",
      metadata: {},
    });

    await expect(
      PaymentService.confirmAndCreateAppointment("pi_123", 9),
    ).rejects.toThrow("O pagamento não foi concluído com sucesso.");
  });

  it("wraps a Stripe retrieve failure", async () => {
    mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error("stripe down"));

    await expect(
      PaymentService.confirmAndCreateAppointment("pi_123", 9),
    ).rejects.toThrow("Erro ao verificar pagamento: stripe down");
  });

  it("rejects when the authenticated user does not exist", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(succeededIntent);
    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      PaymentService.confirmAndCreateAppointment("pi_123", 99),
    ).rejects.toThrow("Cliente (usuário) não encontrado.");
  });

  it("rejects when the user has no client profile", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(succeededIntent);
    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce({ id: 9 });
    (ClientModel.findOne as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      PaymentService.confirmAndCreateAppointment("pi_123", 9),
    ).rejects.toThrow("Cliente não encontrado para o usuário.");
  });

  it("refunds the payment when saving the appointment fails", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(succeededIntent);
    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce({ id: 9 });
    (ClientModel.findOne as jest.Mock).mockResolvedValueOnce({ id: 8 });
    (AppointmentModel.create as jest.Mock).mockRejectedValueOnce(
      new Error("db down"),
    );
    mockRefundsCreate.mockResolvedValueOnce({ id: "re_1" });

    await expect(
      PaymentService.confirmAndCreateAppointment("pi_123", 9),
    ).rejects.toThrow("Erro ao salvar o agendamento no banco de dados.");
    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: "pi_123",
    });
  });
});

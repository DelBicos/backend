import Stripe from "stripe";
import { AppointmentModel } from "../../models/Appointment";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { ServiceModel } from "../../models/Service";
import { NotificationModel } from "../../models/Notification";
import { ensureChatRoomForAppointment } from "../../utils/chatRoom";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return {
    sequelize: new Sequelize({ dialect: "postgres", logging: false }),
  };
});
jest.mock("../../models/Appointment");
jest.mock("../../models/User");
jest.mock("../../models/Client");
jest.mock("../../models/Service");
jest.mock("../../models/Notification");
jest.mock("../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn(),
}));

// --- Mocking Explícito com jest.doMock ---
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

let PaymentService: any;
let MockedStripe: jest.MockedClass<typeof Stripe>;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  PaymentService = require("../payment.service").PaymentService;
  MockedStripe = require("stripe") as jest.MockedClass<typeof Stripe>;
});

describe("PaymentService", () => {
  beforeEach(() => {
    mockPaymentIntentsCreate.mockClear();
  });

  // --- Teste de SUCESSO ---
  it("should create a PaymentIntent and return a client_secret on success", async () => {
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

    const clientSecret = await PaymentService.createPaymentIntent(inputParams);

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
    const errorMessage = "Stripe API error";
    const inputParams = {
      amount: 1000,
      currency: "usd",
    };

    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error(errorMessage));

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
});

describe("PaymentService - confirmAndCreateAppointment", () => {
  const paymentIntentId = "pi_test_123";
  const selectedTime = "2026-10-01T13:00:00.000Z";
  const metadata = {
    professionalId: "20",
    serviceId: "5",
    selectedTime,
    addressId: "2",
  };

  beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: paymentIntentId,
      status: "succeeded",
      metadata: { ...metadata },
    });
    mockRefundsCreate.mockResolvedValue({ id: "re_1" });
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10, user_id: 1 });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
      id: 5,
      title: "Limpeza Residencial",
      duration: 90,
    });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);
    (AppointmentModel.create as jest.Mock).mockImplementation(
      async (data: any) => ({ id: 100, ...data }),
    );
    (NotificationModel.create as jest.Mock).mockResolvedValue({});
  });

  describe("criação", () => {
    it("deve criar o agendamento pending com fim calculado pela duração do serviço", async () => {
      const appointment = await PaymentService.confirmAndCreateAppointment(
        paymentIntentId,
        1,
      );

      expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith(paymentIntentId);
      expect(AppointmentModel.create).toHaveBeenCalledWith({
        professional_id: 20,
        client_id: 10,
        service_id: 5,
        address_id: 2,
        start_time: new Date(selectedTime),
        end_time: new Date("2026-10-01T14:30:00.000Z"),
        status: "pending",
        payment_intent_id: paymentIntentId,
        short_id: expect.stringMatching(/^[0-9A-Z]{6}$/),
      });
      expect(appointment).toEqual(
        expect.objectContaining({ id: 100, status: "pending" }),
      );
    });

    it("deve usar 60 minutos quando o serviço não tiver duração", async () => {
      (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
        id: 5,
        title: "Limpeza Residencial",
        duration: null,
      });

      await PaymentService.confirmAndCreateAppointment(paymentIntentId, 1);

      expect(AppointmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          end_time: new Date("2026-10-01T14:00:00.000Z"),
        }),
      );
    });

    it("deve criar a sala de chat e notificar o cliente", async () => {
      await PaymentService.confirmAndCreateAppointment(paymentIntentId, 1);

      expect(ensureChatRoomForAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 100 }),
      );
      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 1,
          title: "Agendamento Criado com Sucesso",
          notification_type: "appointment",
          related_entity_id: 100,
        }),
      );
    });

    it("deve solicitar reembolso quando o banco falhar ao salvar", async () => {
      (AppointmentModel.create as jest.Mock).mockRejectedValue(
        new Error("falha no banco"),
      );

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("Erro ao salvar o agendamento no banco de dados.");
      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: paymentIntentId,
      });
    });
  });

  describe("validação", () => {
    it("deve recusar pagamento que não foi concluído", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: paymentIntentId,
        status: "requires_payment_method",
        metadata: { ...metadata },
      });

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("O pagamento não foi concluído com sucesso.");
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve propagar erro quando o Stripe não encontrar o pagamento", async () => {
      mockPaymentIntentsRetrieve.mockRejectedValue(
        new Error("No such payment_intent"),
      );

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("Erro ao verificar pagamento: No such payment_intent");
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it.each(["professionalId", "serviceId", "selectedTime", "addressId"])(
      "deve recusar metadados sem %s",
      async (field) => {
        const incomplete: Record<string, string> = { ...metadata };
        delete incomplete[field];
        mockPaymentIntentsRetrieve.mockResolvedValue({
          id: paymentIntentId,
          status: "succeeded",
          metadata: incomplete,
        });

        await expect(
          PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
        ).rejects.toThrow(
          "Dados do agendamento ausentes nos metadados do pagamento.",
        );
        expect(AppointmentModel.create).not.toHaveBeenCalled();
      },
    );

    it("deve recusar quando o usuário não existir", async () => {
      (UserModel.findByPk as jest.Mock).mockResolvedValue(null);

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("Cliente (usuário) não encontrado.");
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve recusar quando o usuário não tiver perfil de cliente", async () => {
      (ClientModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("Cliente não encontrado para o usuário.");
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve recusar quando o serviço não existir", async () => {
      (ServiceModel.findByPk as jest.Mock).mockResolvedValue(null);

      await expect(
        PaymentService.confirmAndCreateAppointment(paymentIntentId, 1),
      ).rejects.toThrow("Serviço não encontrado.");
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });
  });
});

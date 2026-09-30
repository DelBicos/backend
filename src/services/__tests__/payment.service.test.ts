import Stripe from "stripe";
jest.mock("../botAppointmentStatus.service", () => ({ syncBotSessionsForAppointmentStatus: jest.fn() }));

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return {
    sequelize: new Sequelize({ dialect: "postgres", logging: false }),
  };
});

// --- Mocking Explícito com jest.doMock ---
const mockPaymentIntentsCreate = jest.fn();

jest.doMock("stripe", () => {
  return jest.fn().mockImplementation(() => {
    return {
      paymentIntents: {
        create: mockPaymentIntentsCreate,
      },
    };
  });
});

let PaymentService: any;
let MockedStripe: jest.MockedClass<typeof Stripe>;

beforeAll(() => {
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

import { Request, Response } from "express";
import {
  confirmPaymentController,
  createPaymentIntentController,
} from "../payment.controller";
import { PaymentService } from "../../services/payment.service";

jest.mock("../../services/payment.service", () => ({
  PaymentService: {
    createPaymentIntent: jest.fn(),
    confirmAndCreateAppointment: jest.fn(),
  },
  PaymentValidationError: class PaymentValidationError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

const buildResponse = () => {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const res = { status: statusMock, json: jsonMock } as Partial<Response>;
  return { res, jsonMock, statusMock };
};

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("PaymentController - createPaymentIntentController", () => {
  const validBody = {
    amount: 150.5,
    currency: "BRL",
    professionalId: 20,
    selectedTime: "2026-10-01T13:00:00.000Z",
    serviceId: 5,
    addressId: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (PaymentService.createPaymentIntent as jest.Mock).mockResolvedValue(
      "pi_123_secret_456",
    );
  });

  it("deve criar o PaymentIntent com valor em centavos e dados do agendamento", async () => {
    const { res, jsonMock, statusMock } = buildResponse();

    await createPaymentIntentController(
      { body: { ...validBody } } as Request,
      res as Response,
    );

    expect(PaymentService.createPaymentIntent).toHaveBeenCalledWith({
      amount: 15050,
      currency: "brl",
      metadata: {
        professionalId: "20",
        serviceId: "5",
        selectedTime: validBody.selectedTime,
        addressId: "2",
      },
    });
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ clientSecret: "pi_123_secret_456" });
  });

  it.each([
    ["ausente", undefined],
    ["zero", 0],
    ["negativo", -10],
    ["texto", "50"],
  ])("deve retornar 400 quando amount for %s", async (_label, amount) => {
    const { res, jsonMock, statusMock } = buildResponse();

    await createPaymentIntentController(
      { body: { ...validBody, amount } } as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: expect.stringContaining('Parâmetro "amount" inválido'),
    });
    expect(PaymentService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it.each([
    ["ausente", undefined],
    ["com 2 letras", "br"],
    ["com 4 letras", "brls"],
  ])("deve retornar 400 quando currency for %s", async (_label, currency) => {
    const { res, jsonMock, statusMock } = buildResponse();

    await createPaymentIntentController(
      { body: { ...validBody, currency } } as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: expect.stringContaining('Parâmetro "currency" inválido'),
    });
    expect(PaymentService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it.each(["professionalId", "selectedTime", "serviceId", "addressId"])(
    "deve retornar 400 quando %s estiver ausente",
    async (field) => {
      const { res, jsonMock, statusMock } = buildResponse();
      const body: Record<string, unknown> = { ...validBody };
      delete body[field];

      await createPaymentIntentController(
        { body } as Request,
        res as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error:
          "Dados do agendamento (professionalId, selectedTime, serviceId, addressId) são obrigatórios.",
      });
      expect(PaymentService.createPaymentIntent).not.toHaveBeenCalled();
    },
  );

  it("deve retornar 500 quando o provedor de pagamento falhar", async () => {
    (PaymentService.createPaymentIntent as jest.Mock).mockRejectedValue(
      new Error("Stripe fora do ar"),
    );
    const { res, jsonMock, statusMock } = buildResponse();

    await createPaymentIntentController(
      { body: { ...validBody } } as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Falha ao processar o pagamento. Por favor, tente novamente.",
    });
  });
});

describe("PaymentController - confirmPaymentController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar 201 com o agendamento criado", async () => {
    const appointment = { id: 100, short_id: "A1B2C3", status: "pending" };
    (PaymentService.confirmAndCreateAppointment as jest.Mock).mockResolvedValue(
      appointment,
    );
    const { res, jsonMock, statusMock } = buildResponse();

    await confirmPaymentController(
      {
        user: { id: 1 },
        body: { paymentIntentId: "pi_test_123", userId: "999" },
      } as unknown as Request,
      res as Response,
    );

    expect(PaymentService.confirmAndCreateAppointment).toHaveBeenCalledWith(
      "pi_test_123",
      1,
    );
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      message: "Agendamento criado com sucesso!",
      appointment,
    });
  });

  it("deve retornar 400 quando paymentIntentId estiver ausente", async () => {
    const { res, jsonMock, statusMock } = buildResponse();

    await confirmPaymentController(
      { body: { userId: 1 } } as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O ID do pagamento (paymentIntentId) é obrigatório.",
    });
    expect(PaymentService.confirmAndCreateAppointment).not.toHaveBeenCalled();
  });

  it("deve retornar 401 quando o usuário não estiver autenticado", async () => {
    const { res, jsonMock, statusMock } = buildResponse();

    await confirmPaymentController(
      { body: { paymentIntentId: "pi_test_123", userId: 1 } } as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Usuário não autenticado.",
    });
    expect(PaymentService.confirmAndCreateAppointment).not.toHaveBeenCalled();
  });

  it("deve retornar 500 com a mensagem do serviço quando a confirmação falhar", async () => {
    (PaymentService.confirmAndCreateAppointment as jest.Mock).mockRejectedValue(
      new Error("O pagamento não foi concluído com sucesso."),
    );
    const { res, jsonMock, statusMock } = buildResponse();

    await confirmPaymentController(
      {
        user: { id: 1 },
        body: { paymentIntentId: "pi_test_123" },
      } as unknown as Request,
      res as Response,
    );

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O pagamento não foi concluído com sucesso.",
    });
  });
});

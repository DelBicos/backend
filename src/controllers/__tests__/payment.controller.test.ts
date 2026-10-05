import { Request, Response } from "express";
import {
  confirmPaymentController as confirmPaymentHandler,
  createPaymentIntentController as createPaymentIntentHandler,
} from "../payment.controller";
import { PaymentService } from "../../services/payment.service";
import { HttpError } from "../../errors/HttpError";
import { nextToErrorHandler, settled } from "./handlerTestUtils";

jest.mock("../../services/payment.service", () => ({
  PaymentService: {
    createBookingPaymentIntent: jest.fn(),
    confirmAndCreateAppointment: jest.fn(),
  },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

const createPaymentIntentController = settled(createPaymentIntentHandler);
const confirmPaymentController = settled(confirmPaymentHandler);

/** Chama o controller e devolve os mocks de resposta (erros passam pelo errorHandler). */
const call = async (
  handler: typeof createPaymentIntentController,
  request: unknown,
) => {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const res = { status: statusMock, json: jsonMock } as Partial<Response>;
  const next = nextToErrorHandler(() => request, () => res);
  await handler(request as Request, res as Response, next);
  return { jsonMock, statusMock };
};

describe("PaymentController - createPaymentIntentController", () => {
  const validBody = {
    professionalId: 20,
    selectedTime: "2026-10-01T13:00:00.000Z",
    serviceId: 5,
    addressId: 2,
  };
  const authed = (body: Record<string, unknown>) => ({ user: { id: 1 }, body });

  beforeEach(() => {
    jest.clearAllMocks();
    (PaymentService.createBookingPaymentIntent as jest.Mock).mockResolvedValue(
      "pi_123_secret_456",
    );
  });

  it("deve criar o PaymentIntent do agendamento para o usuário autenticado", async () => {
    const { jsonMock, statusMock } = await call(
      createPaymentIntentController,
      authed({ ...validBody }),
    );

    expect(PaymentService.createBookingPaymentIntent).toHaveBeenCalledWith(1, {
      professionalId: 20,
      selectedTime: validBody.selectedTime,
      serviceId: 5,
      addressId: 2,
      appointmentId: undefined,
    });
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ clientSecret: "pi_123_secret_456" });
  });

  // O valor deixou de vir do app: o servidor calcula pelo preço do serviço
  // (servicePriceInCents; ver AG-L-16 em payment.service.test.ts).
  it.each([
    ["ausente", undefined],
    ["zero", 0],
    ["negativo", -10],
    ["texto", "50"],
    ["0.01", 0.01],
  ])("deve ignorar o amount enviado pelo app (%s)", async (_label, amount) => {
    const { statusMock } = await call(
      createPaymentIntentController,
      authed({ ...validBody, amount, currency: "usd" }),
    );

    const [, input] = (PaymentService.createBookingPaymentIntent as jest.Mock).mock.calls[0];
    expect(input).not.toHaveProperty("amount");
    expect(input).not.toHaveProperty("currency");
    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it("deve retornar 401 quando o usuário não estiver autenticado", async () => {
    const { statusMock } = await call(createPaymentIntentController, {
      body: { ...validBody },
    });

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(PaymentService.createBookingPaymentIntent).not.toHaveBeenCalled();
  });

  // A validação dos campos do agendamento vive em PaymentService
  // (createBookingPaymentIntent) e é testada em payment.capture.test.ts.
  it.each(["professionalId", "selectedTime", "serviceId", "addressId"])(
    "deve devolver o 400 do serviço quando %s estiver ausente",
    async (field) => {
      const body: Record<string, unknown> = { ...validBody };
      delete body[field];
      (PaymentService.createBookingPaymentIntent as jest.Mock).mockRejectedValue(
        HttpError.badRequest(
          "Dados do agendamento (professionalId, selectedTime, serviceId, addressId) são obrigatórios.",
        ),
      );

      const { jsonMock, statusMock } = await call(createPaymentIntentController, authed(body));

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error:
          "Dados do agendamento (professionalId, selectedTime, serviceId, addressId) são obrigatórios.",
      });
    },
  );

  it("deve retornar 500 genérico quando o provedor de pagamento falhar", async () => {
    (PaymentService.createBookingPaymentIntent as jest.Mock).mockRejectedValue(
      new Error("Stripe fora do ar"),
    );

    const { jsonMock, statusMock } = await call(
      createPaymentIntentController,
      authed({ ...validBody }),
    );

    // Falhas inesperadas nao vazam a mensagem interna ao cliente.
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Erro interno do servidor" });
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

    const { jsonMock, statusMock } = await call(confirmPaymentController, {
      user: { id: 1 },
      body: { paymentIntentId: "pi_test_123", userId: "999" },
    });

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
    const { jsonMock, statusMock } = await call(confirmPaymentController, {
      body: { userId: 1 },
    });

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O ID do pagamento (paymentIntentId) é obrigatório.",
    });
    expect(PaymentService.confirmAndCreateAppointment).not.toHaveBeenCalled();
  });

  it("deve retornar 401 quando o usuário não estiver autenticado", async () => {
    const { jsonMock, statusMock } = await call(confirmPaymentController, {
      body: { paymentIntentId: "pi_test_123", userId: 1 },
    });

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
    expect(PaymentService.confirmAndCreateAppointment).not.toHaveBeenCalled();
  });

  it("deve devolver o erro de domínio do serviço quando a confirmação falhar", async () => {
    (PaymentService.confirmAndCreateAppointment as jest.Mock).mockRejectedValue(
      HttpError.badRequest("O pagamento não foi autorizado."),
    );

    const { jsonMock, statusMock } = await call(confirmPaymentController, {
      user: { id: 1 },
      body: { paymentIntentId: "pi_test_123" },
    });

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O pagamento não foi autorizado.",
    });
  });

  it("deve retornar 500 genérico em falhas inesperadas", async () => {
    (PaymentService.confirmAndCreateAppointment as jest.Mock).mockRejectedValue(
      new Error("conexão perdida"),
    );

    const { jsonMock, statusMock } = await call(confirmPaymentController, {
      user: { id: 1 },
      body: { paymentIntentId: "pi_test_123" },
    });

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Erro interno do servidor" });
  });
});

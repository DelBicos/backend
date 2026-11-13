jest.mock("../../services/payment.service", () => ({
  PaymentService: {
    createPaymentIntent: jest.fn(),
    confirmAndCreateAppointment: jest.fn(),
  },
}));

import { PaymentService } from "../../services/payment.service";
import {
  confirmPaymentController,
  createPaymentIntentController,
} from "../payment.controller";
import { mockReq, mockRes } from "../../test/http";

const createIntent = PaymentService.createPaymentIntent as jest.Mock;
const confirm = PaymentService.confirmAndCreateAppointment as jest.Mock;

const validBody = {
  amount: 50,
  currency: "BRL",
  professionalId: 2,
  selectedTime: "2026-05-01T10:00:00.000Z",
  serviceId: 3,
  addressId: 4,
};

describe("createPaymentIntentController", () => {
  it("returns 400 when amount is invalid", async () => {
    const res = mockRes();
    await createPaymentIntentController(
      mockReq({ body: { ...validBody, amount: 0 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when currency is not a 3-letter code", async () => {
    const res = mockRes();
    await createPaymentIntentController(
      mockReq({ body: { ...validBody, currency: "real" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when appointment data is missing", async () => {
    const res = mockRes();
    await createPaymentIntentController(
      mockReq({ body: { amount: 50, currency: "brl" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 200 with the client secret", async () => {
    createIntent.mockResolvedValue("pi_secret");
    const res = mockRes();
    await createPaymentIntentController(mockReq({ body: validBody }) as any, res);
    expect(createIntent).toHaveBeenCalledWith({
      amount: 5000,
      currency: "brl",
      metadata: {
        professionalId: "2",
        serviceId: "3",
        selectedTime: validBody.selectedTime,
        addressId: "4",
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ clientSecret: "pi_secret" });
  });

  it("returns 500 when the service throws", async () => {
    createIntent.mockRejectedValue(new Error("stripe"));
    const res = mockRes();
    await createPaymentIntentController(mockReq({ body: validBody }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Falha ao processar o pagamento. Por favor, tente novamente.",
    });
  });
});

describe("confirmPaymentController", () => {
  it("returns 400 when paymentIntentId is missing", async () => {
    const res = mockRes();
    await confirmPaymentController(mockReq({ body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when userId is missing", async () => {
    const res = mockRes();
    await confirmPaymentController(
      mockReq({ body: { paymentIntentId: "pi_1" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 201 when the appointment is created", async () => {
    confirm.mockResolvedValue({ id: 11 });
    const res = mockRes();
    await confirmPaymentController(
      mockReq({ body: { paymentIntentId: "pi_1", userId: 9 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Agendamento criado com sucesso!",
      appointment: { id: 11 },
    });
  });

  it("returns 500 with the service error message", async () => {
    confirm.mockRejectedValue(new Error("O pagamento não foi concluído com sucesso."));
    const res = mockRes();
    await confirmPaymentController(
      mockReq({ body: { paymentIntentId: "pi_1", userId: 9 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "O pagamento não foi concluído com sucesso.",
    });
  });
});

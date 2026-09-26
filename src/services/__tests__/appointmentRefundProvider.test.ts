const mockRetrieve = jest.fn();
const mockList = jest.fn();
const mockCreate = jest.fn();
jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  paymentIntents: { retrieve: mockRetrieve }, refunds: { list: mockList, create: mockCreate },
})));
import { ensureAppointmentRefund } from "../appointmentRefundProvider.service";

const previousKey = process.env.STRIPE_SECRET_KEY;
beforeAll(() => { process.env.STRIPE_SECRET_KEY = "sk_test_mock"; });
afterAll(() => {
  if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = previousKey;
});
beforeEach(() => {
  mockRetrieve.mockReset();
  mockList.mockReset();
  mockCreate.mockReset();
  mockRetrieve.mockResolvedValue({ status: "succeeded", amount_received: 15000 });
  mockList.mockReturnValue([]);
  mockCreate.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 15000 });
});

it("solicita estorno total com chave estável", async () => {
  expect(await ensureAppointmentRefund("pi_paid")).toBe(true);
  expect(mockCreate).toHaveBeenCalledWith({ payment_intent: "pi_paid" }, {
    idempotencyKey: "appointment-refund:pi_paid:initial",
  });
});
it("repete a mesma chave após timeout sem confirmação no provedor", async () => {
  mockCreate.mockRejectedValueOnce(new Error("timeout"));
  await expect(ensureAppointmentRefund("pi_paid")).rejects.toThrow("timeout");
  await ensureAppointmentRefund("pi_paid");
  expect(mockCreate.mock.calls[0]).toEqual(mockCreate.mock.calls[1]);
});
it("reconcilia estorno concluído após crash ou expiração da chave, sem reenviar", async () => {
  mockList.mockReturnValue([{ id: "re_1", status: "succeeded", amount: 15000 }]);
  expect(await ensureAppointmentRefund("pi_paid")).toBe(true);
  expect(mockCreate).not.toHaveBeenCalled();
});
it.each(["pending", "requires_action"])("aguarda estorno %s sem duplicá-lo nem marcá-lo concluído", async (status) => {
  mockList.mockReturnValue([{ id: "re_1", status, amount: 15000 }]);
  expect(await ensureAppointmentRefund("pi_paid")).toBe(false);
  expect(mockCreate).not.toHaveBeenCalled();
});
it("não trata a aceitação assíncrona como estorno concluído", async () => {
  mockCreate.mockResolvedValue({ id: "re_1", status: "pending", amount: 15000 });
  expect(await ensureAppointmentRefund("pi_paid")).toBe(false);
});
it.each(["failed", "canceled"])("permite nova tentativa após estorno %s", async (status) => {
  mockList.mockReturnValue([{ id: "re_failed", status, amount: 15000 }]);
  expect(await ensureAppointmentRefund("pi_paid")).toBe(true);
  expect(mockCreate.mock.calls[0][1].idempotencyKey).toBe("appointment-refund:pi_paid:re_failed");
});
it("completa somente o saldo restante de um estorno parcial", async () => {
  mockList.mockReturnValue([{ id: "re_partial", status: "succeeded", amount: 5000 }]);
  mockCreate.mockResolvedValue({ id: "re_rest", status: "succeeded", amount: 10000 });
  expect(await ensureAppointmentRefund("pi_paid")).toBe(true);
  expect(mockCreate.mock.calls[0][0]).toEqual({ payment_intent: "pi_paid" });
});
it("não inicia outro estorno se a reconciliação falhar", async () => {
  mockList.mockImplementation(() => { throw new Error("offline"); });
  await expect(ensureAppointmentRefund("pi_paid")).rejects.toThrow("offline");
  expect(mockCreate).not.toHaveBeenCalled();
});

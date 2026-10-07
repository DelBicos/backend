jest.mock("../appointment.controller", () => ({ updateAppointmentStatus: jest.fn() }));
jest.mock("../../services/appointment/cancellationVerification.service", () => ({
  requestCancellationCode: jest.fn(), confirmCancellationCode: jest.fn(), abandonCancellationCode: jest.fn(),
  resolveCancellationAppointment: jest.fn(), CancellationVerificationError: class extends Error {},
}));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { warn: jest.fn() } }));
import { Request, Response } from "express";
import { confirmCancellation, updateVerifiedAppointmentStatus } from "../cancellationVerification.controller";
import { updateAppointmentStatus } from "../appointment.controller";
import { confirmCancellationCode, resolveCancellationAppointment } from "../../services/appointment/cancellationVerification.service";
const json = jest.fn();
const status = jest.fn();
const response = { status, json } as unknown as Response;
beforeEach(() => {
  jest.clearAllMocks();
  status.mockReturnValue(response);
  (resolveCancellationAppointment as jest.Mock).mockResolvedValue(92);
});
it.each(["direct", "legacy"])("bloqueia cancelamento sem código pela rota %s", async (route) => {
  const request = { user: { id: 6 }, params: { id: "92" }, body: { status: "canceled" } } as unknown as Request;
  await (route === "direct" ? confirmCancellation : updateVerifiedAppointmentStatus)(request, response);
  expect(status).toHaveBeenCalledWith(400);
  expect(confirmCancellationCode).not.toHaveBeenCalled();
  expect(updateAppointmentStatus).not.toHaveBeenCalled();
});
it("usa identidade autenticada e valida código antes de responder sucesso", async () => {
  const request = { user: { id: 6 }, params: { id: "92" }, body: { user_id: 99, code: "123456", challengeId: "challenge" } } as unknown as Request;
  await confirmCancellation(request, response);
  expect(confirmCancellationCode).toHaveBeenCalledWith(6, 92, "challenge", "123456");
  expect(json).toHaveBeenCalledWith({ status: "canceled" });
});
it("aceitação continua no fluxo existente", async () => {
  const request = { body: { status: "confirmed" } } as Request;
  await updateVerifiedAppointmentStatus(request, response);
  expect(updateAppointmentStatus).toHaveBeenCalledWith(request, response);
  expect(confirmCancellationCode).not.toHaveBeenCalled();
});

jest.mock("../../services/auth/registration.service", () => ({
  requestRegistration: jest.fn(), resendRegistration: jest.fn(), verifyRegistration: jest.fn(),
  RegistrationError: class extends Error { constructor(message: string, public status: number) { super(message); } },
}));
jest.mock("../../utils/authUtils", () => ({ generateTokenAndUserPayload: jest.fn() }));
jest.mock("../../services/loginLog.service", () => ({ saveLoginLog: jest.fn() }));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { warn: jest.fn() } }));
import express from "express";
import request from "supertest";
import { handleRegister, handleResendCode } from "../auth.controller";
import { requestRegistration, resendRegistration, RegistrationError } from "../../services/auth/registration.service";
const app = express();
app.use(express.json());
app.post("/register", handleRegister);
app.post("/resend", handleResendCode);
beforeEach(() => jest.resetAllMocks());
it("reenvio recusado pelo SMTP retorna 503, nunca sucesso", async () => {
  (resendRegistration as jest.Mock).mockRejectedValue(new RegistrationError("Falha ao enviar o e-mail.", 503));
  const response = await request(app).post("/resend").send({ email: "test@example.com" });
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: "Falha ao enviar o e-mail." });
});
it("cadastro recusado pelo SMTP retorna erro sem informar código enviado", async () => {
  (requestRegistration as jest.Mock).mockRejectedValue(new RegistrationError("Falha ao enviar o e-mail.", 503));
  const response = await request(app).post("/register").send({ name: "Teste", email: "test@example.com", password: "test", cpf: "000", phone: "15999999999",
    address: { postal_code: "18000000", street: "Rua", number: "1", neighborhood: "Centro", city: "Sorocaba", state: "SP" } });
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: "Falha ao enviar o e-mail." });
});
it("reenvio aceito mantém contrato de sucesso", async () => {
  const response = await request(app).post("/resend").send({ email: "test@example.com" });
  expect(response.status).toBe(200);
  expect(response.body.message).toBe("Código reenviado com sucesso!");
});

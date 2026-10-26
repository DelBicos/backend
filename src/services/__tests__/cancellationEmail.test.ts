const mockSendMail = jest.fn();
const mockClose = jest.fn();
jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, close: mockClose })) } }));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { warn: jest.fn() } }));
import nodemailer from "nodemailer";
import logger from "../../utils/logger";
import { sendCancellationCode } from "../email/cancellationEmail.service";
const names = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
const original = names.map((name) => process.env[name]);
beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockReset().mockResolvedValue({ accepted: ["client@example.com"] });
  Object.assign(process.env, { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_USER: "sender@example.com", SMTP_PASS: "test-password", EMAIL_FROM: "sender@example.com" });
});
afterAll(() => {
  names.forEach((name, index) => {
    if (original[index] === undefined) delete process.env[name];
    else process.env[name] = original[index];
  });
});
it("envia para o e-mail cadastrado com validade e aviso de reserva ativa", async () => {
  await sendCancellationCode("client@example.com", "123456");
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "client@example.com", from: "sender@example.com",
    text: expect.stringContaining("123456"), html: expect.stringContaining("permanece ativo") }));
});
it("não expõe respostas do provedor, destinatário ou código ao log", async () => {
  (mockSendMail as jest.Mock).mockRejectedValue(new Error("private provider payload 123456"));
  await expect(sendCancellationCode("client@example.com", "123456")).rejects.toThrow("Não foi possível enviar");
  expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toMatch(/123456|client@example|private provider/);
});
it("exige configuração de envio", async () => {
  delete process.env.SMTP_PASS;
  await expect(sendCancellationCode("client@example.com", "123456")).rejects.toThrow("não configurado");
  expect(mockSendMail).not.toHaveBeenCalled();
});

it("exige TLS na porta 587 e encerra transporte", async () => {
  await sendCancellationCode("client@example.com", "123456");
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true }));
  expect(mockClose).toHaveBeenCalled();
});
it("não declara sucesso quando o SMTP recusa o destinatário", async () => {
  mockSendMail.mockResolvedValue({ accepted: [] });
  await expect(sendCancellationCode("client@example.com", "123456")).rejects.toThrow("Não foi possível enviar");
  expect(mockClose).toHaveBeenCalled();
});
const sendMail = jest.fn();
jest.mock("../../config/mailer", () => ({
  getSmtpTransporter: jest.fn(),
  getSenderAddress: jest.fn(),
}));
jest.mock("../../utils/azureEmailFunction", () => ({ sendViaAzureFunction: jest.fn() }));

import { getSenderAddress, getSmtpTransporter } from "../../config/mailer";
import { sendViaAzureFunction } from "../../utils/azureEmailFunction";
import { EmailService } from "../email.service";

describe("EmailService: SMTP com fallback Azure", () => {
  const message = { to: "user@example.com", subject: "Teste", html: "<p>Mensagem</p>" };

  beforeEach(() => {
    jest.resetAllMocks();
    (getSmtpTransporter as jest.Mock).mockReturnValue({ sendMail });
    (getSenderAddress as jest.Mock).mockReturnValue('"DelBicos" <sender@example.com>');
  });

  it("envia por SMTP e não chama o fallback", async () => {
    sendMail.mockResolvedValue({ messageId: "1" });
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith({ from: '"DelBicos" <sender@example.com>', ...message });
    expect(sendViaAzureFunction).not.toHaveBeenCalled();
  });

  it.each([true, false])("propaga o resultado Azure (%s) após falha do SMTP", async (result) => {
    sendMail.mockRejectedValue(Object.assign(new Error("auth"), { code: "EAUTH" }));
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(result);
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(result);
    expect(sendViaAzureFunction).toHaveBeenCalledWith(message);
  });

  it("usa o fallback quando o SMTP não está configurado", async () => {
    (getSmtpTransporter as jest.Mock).mockReturnValue(null);
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(true);
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("retorna false quando nenhum envio funciona", async () => {
    (getSmtpTransporter as jest.Mock).mockReturnValue(null);
    (sendViaAzureFunction as jest.Mock).mockRejectedValue(new Error("rede"));
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(false);
  });
});

jest.mock("../../config/sendgrid", () => ({ __esModule: true, default: { send: jest.fn() } }));
jest.mock("../../utils/azureEmailFunction", () => ({ sendViaAzureFunction: jest.fn() }));

import sgMail from "../../config/sendgrid";
import { sendViaAzureFunction } from "../../utils/azureEmailFunction";
import { EmailService } from "../email.service";

describe("EmailService: fallback Azure", () => {
  const previousSender = process.env.SENDER_EMAIL_VERIFICADO;
  const message = { to: "user@example.com", subject: "Teste", html: "<p>Mensagem</p>" };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SENDER_EMAIL_VERIFICADO = "sender@example.com";
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "info").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousSender === undefined) delete process.env.SENDER_EMAIL_VERIFICADO;
    else process.env.SENDER_EMAIL_VERIFICADO = previousSender;
  });

  it("não chama o fallback quando SendGrid funciona", async () => {
    (sgMail.send as jest.Mock).mockResolvedValue([]);
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(true);
    expect(sendViaAzureFunction).not.toHaveBeenCalled();
  });

  it.each([true, false])("propaga o resultado Azure (%s) após falha do SendGrid", async (result) => {
    (sgMail.send as jest.Mock).mockRejectedValue(new Error("SendGrid indisponível"));
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(result);
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(result);
    expect(sendViaAzureFunction).toHaveBeenCalledTimes(1);
    expect(sendViaAzureFunction).toHaveBeenCalledWith(message);
  });
});

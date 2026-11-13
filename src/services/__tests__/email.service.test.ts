jest.mock("../../config/sendgrid", () => ({
  __esModule: true,
  default: { send: jest.fn() },
}));

jest.mock("../../utils/emailFallback", () => ({
  sendViaLambda: jest.fn(),
}));

import sgMail from "../../config/sendgrid";
import { sendViaLambda } from "../../utils/emailFallback";
import { EmailService } from "../email.service";

const send = sgMail.send as jest.Mock;
const fallback = sendViaLambda as jest.Mock;

const message = {
  to: "ana@example.com",
  subject: "Olá",
  html: "<p>oi</p>",
};

describe("EmailService.sendTransactionalEmail", () => {
  const previousSender = process.env.SENDER_EMAIL_VERIFICADO;

  afterEach(() => {
    process.env.SENDER_EMAIL_VERIFICADO = previousSender;
  });

  it("returns false when the sender address is not configured", async () => {
    delete process.env.SENDER_EMAIL_VERIFICADO;
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("returns true when the provider accepts the message", async () => {
    send.mockResolvedValue([{ statusCode: 202 }]);
    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(
      true,
    );
    expect(send).toHaveBeenCalledWith({
      to: message.to,
      from: process.env.SENDER_EMAIL_VERIFICADO,
      subject: message.subject,
      html: message.html,
    });
  });

  it("uses the lambda fallback when the provider fails", async () => {
    send.mockRejectedValue(new Error("sendgrid down"));
    fallback.mockResolvedValue(true);

    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(
      true,
    );
    expect(fallback).toHaveBeenCalledWith(message);
  });

  it("returns false when the provider and the fallback both fail", async () => {
    send.mockRejectedValue(new Error("sendgrid down"));
    fallback.mockResolvedValue(false);

    await expect(EmailService.sendTransactionalEmail(message)).resolves.toBe(
      false,
    );
  });
});

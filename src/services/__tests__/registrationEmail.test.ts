jest.mock("../email/smtp.service", () => ({ sendTransactionalEmail: jest.fn() }));
import { sendTransactionalEmail } from "../email/smtp.service";
import { sendRegistrationCode } from "../email/registrationEmail.service";
it.each([false, true])("envia cadastro/reenvio por SMTP (resend=%s) e escapa nome", async (resend) => {
  await sendRegistrationCode("test@example.com", "<img src=x>", "123456", resend);
  expect(sendTransactionalEmail).toHaveBeenLastCalledWith(expect.objectContaining({
    to: "test@example.com", subject: resend ? "Novo Código de Verificação - DelBicos" : "Seu Código de Verificação",
    html: expect.stringContaining("&lt;img src=x&gt;"),
  }));
});

import sgMail from "../config/sendgrid";
import { sendViaAzureFunction } from "../utils/azureEmailFunction";

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export const EmailService = {
  sendTransactionalEmail: async ({
    to,
    subject,
    html,
  }: EmailParams): Promise<boolean> => {
    const fromEmail = process.env.SENDER_EMAIL_VERIFICADO;

    if (!fromEmail) {
      console.error("E-mail remetente verificado não encontrado no .env");
      return false;
    }

    const msg = {
      to,
      from: fromEmail,
      subject,
      html,
    };

    try {
      await sgMail.send(msg);
      return true;
    } catch (error) {
      console.error("Erro ao enviar e-mail pelo serviço:", error);
      if (typeof error === "object" && error !== null && "response" in error) {
        const err = error as { response?: { body?: any } };
        console.error(err.response?.body);
      }
      // Tentar fallback via Azure Function
      try {
        const fallbackResult = await sendViaAzureFunction({
          to,
          subject,
          html,
        });
        if (fallbackResult) {
          console.info("E-mail enviado via Azure Function fallback");
          return true;
        }
      } catch (err) {
        console.error("Erro no fallback via Azure Function:", err);
      }
      return false;
    }
  },
};

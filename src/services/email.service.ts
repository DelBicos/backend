import sgMail from "../config/sendgrid";
import { sendViaAzureFunction } from "../utils/azureEmailFunction";

import logger, { logError } from "../utils/logger";
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
      logger.error("E-mail remetente verificado não encontrado no .env");
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
      logError("Erro ao enviar e-mail pelo serviço:", error);
      if (typeof error === "object" && error !== null && "response" in error) {
        const err = error as { response?: { body?: unknown } };
        logger.error(err.response?.body);
      }
      // Tentar fallback via Azure Function
      try {
        const fallbackResult = await sendViaAzureFunction({
          to,
          subject,
          html,
        });
        if (fallbackResult) {
          logger.info("E-mail enviado via Azure Function fallback");
          return true;
        }
      } catch (err) {
        logError("Erro no fallback via Azure Function:", err);
      }
      return false;
    }
  },
};

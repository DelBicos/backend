import { getSenderAddress, getSmtpTransporter } from "../config/mailer";
import { sendViaAzureFunction } from "../utils/azureEmailFunction";

import logger, { logError } from "../utils/logger";
interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

/** Tenta o SMTP (principal) e, se falhar ou nao estiver configurado, a Azure Function. */
async function sendViaSmtp({ to, subject, html }: EmailParams): Promise<boolean> {
  const transporter = getSmtpTransporter();
  if (!transporter) {
    logger.warn("SMTP não configurado (SMTP_USER/SMTP_PASS); usando fallback");
    return false;
  }
  const from = getSenderAddress();
  if (!from) {
    logger.error("Remetente de e-mail não configurado");
    return false;
  }
  try {
    await transporter.sendMail({ from, to, subject, html });
    return true;
  } catch (error) {
    // Nao registra destinatario nem conteudo da mensagem.
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "desconhecido";
    logger.error(`Falha ao enviar e-mail por SMTP (código ${code})`);
    return false;
  }
}

export const EmailService = {
  sendTransactionalEmail: async (params: EmailParams): Promise<boolean> => {
    if (await sendViaSmtp(params)) return true;

    try {
      const fallbackResult = await sendViaAzureFunction(params);
      if (fallbackResult) {
        logger.info("E-mail enviado via Azure Function fallback");
        return true;
      }
    } catch (err) {
      logError("Erro no fallback via Azure Function:", err);
    }
    return false;
  },
};

import nodemailer from "nodemailer";
import logger from "../../utils/logger";

export async function sendTransactionalEmail(message: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;
  if (!host || !user || !pass || !from || ![465, 587].includes(port))
    throw new Error("Serviço de e-mail não configurado");
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true,
    auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  try {
    const result = await transport.sendMail({
      ...message, from,
    });
    if (!result.accepted.length) throw new Error("Destinatário recusado");
  } catch {
    // Respostas do provedor podem conter destinatário, credenciais e o código.
    logger.warn("SMTP: falha no envio de e-mail");
    throw new Error("Não foi possível enviar o código. Tente novamente mais tarde.");
  } finally {
    transport.close();
  }
}

import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/**
 * Envio de e-mail por SMTP (padrao: Gmail com senha de app, gratuito).
 * Sem SMTP_USER/SMTP_PASS o transporte fica desligado e o servico de
 * e-mail tenta o fallback (Azure Function), sem derrubar a API.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

const DEFAULT_HOST = "smtp.gmail.com";
const DEFAULT_PORT = 587;

export function readSmtpConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmtpConfig | null {
  const user = env.SMTP_USER?.trim();
  // Senha de app do Gmail e exibida com espacos; o SMTP aceita sem eles.
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");
  if (!user || !pass) return null;

  const port = Number(env.SMTP_PORT);
  const validPort = Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
  return {
    host: env.SMTP_HOST?.trim() || DEFAULT_HOST,
    port: validPort,
    // 465 usa TLS direto; 587 comeca em texto e sobe para TLS (STARTTLS).
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : validPort === 465,
    user,
    pass,
  };
}

let cached: { key: string; transporter: Transporter } | null = null;

export function getSmtpTransporter(): Transporter | null {
  const config = readSmtpConfig();
  if (!config) return null;
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.pass}`;
  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transporter;
}

/** Remetente: SENDER_EMAIL_VERIFICADO ou a propria conta SMTP. */
export function getSenderAddress(): string | null {
  const email =
    process.env.SENDER_EMAIL_VERIFICADO?.trim() ||
    process.env.SMTP_USER?.trim();
  if (!email) return null;
  const name = process.env.SENDER_NAME?.trim() || "DelBicos";
  return `"${name.replace(/"/g, "")}" <${email}>`;
}

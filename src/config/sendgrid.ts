import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";

import logger from "../utils/logger";
dotenv.config();

const apiKey = process.env.SENDGRID_API_KEY;

if (!apiKey) {
  logger.error(
    "Chave de API do SendGrid não encontrada. Verifique o arquivo .env"
  );
  process.exit(1); // Encerra a aplicação se a chave não estiver configurada
}

sgMail.setApiKey(apiKey);

export default sgMail;

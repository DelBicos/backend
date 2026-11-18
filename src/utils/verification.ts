import { randomInt } from "crypto";

/**
 * Gera um código de verificação numérico de 6 dígitos com gerador
 * criptograficamente seguro (Math.random é previsível).
 */
export const generateVerificationCode = (): string => {
  return randomInt(100000, 1000000).toString();
};

import crypto from "crypto";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Gera um código de confirmação no formato AB-12 (2 letras maiúsculas + hífen + 2 dígitos).
 * Utiliza gerador criptograficamente seguro (não-sequencial).
 */
export function generateConfirmationCode(): string {
  const letter1 = LETTERS[crypto.randomInt(0, LETTERS.length)];
  const letter2 = LETTERS[crypto.randomInt(0, LETTERS.length)];
  const digit1 = crypto.randomInt(0, 10);
  const digit2 = crypto.randomInt(0, 10);

  return `${letter1}${letter2}-${digit1}${digit2}`;
}

/**
 * Valida se o formato do código corresponde estritamente a AB-12 (case-sensitive).
 */
export function isValidConfirmationCodeFormat(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  return /^[A-Z]{2}-[0-9]{2}$/.test(code.trim());
}

/**
 * Compara o código informado com o armazenado (case-sensitive).
 * O hífen é ignorado nos dois lados: "AB12" confere com "AB-12" e códigos legados
 * de 4 dígitos ("1234") conferem com a entrada formatada pelo app ("12-34").
 */
export function confirmationCodesMatch(input: unknown, stored: unknown): boolean {
  const strip = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/-/g, "") : "";
  const cleanInput = strip(input);
  return cleanInput.length > 0 && cleanInput === strip(stored);
}

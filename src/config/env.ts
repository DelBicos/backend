/**
 * Acesso centralizado as variaveis de ambiente obrigatorias.
 *
 * Os getters sao lazy (lidos no momento do uso) para que testes possam
 * definir process.env antes de chamar o codigo. Em runtime, o bootstrap
 * chama assertRequiredEnv() para falhar logo na subida do servidor.
 */

/** Tamanho recomendado para o segredo HS256; abaixo disso so gera aviso. */
export const RECOMMENDED_JWT_SECRET_LENGTH = 32;

export class MissingEnvError extends Error {
  constructor(name: string, hint = "") {
    super(`Variavel de ambiente obrigatoria ausente ou invalida: ${name}${hint}`);
    this.name = "MissingEnvError";
  }
}

export function getJwtSecret(): string {
  const secret = process.env.SECRET_KEY;
  if (!secret) throw new MissingEnvError("SECRET_KEY");
  return secret;
}

export function getJwtExpiresIn(): string {
  return process.env.EXPIRES_IN || "1h";
}

export function isProduction(): boolean {
  return (process.env.ENVIRONMENT || process.env.NODE_ENV) === "production";
}

/**
 * Valida, na subida do servidor, tudo que e obrigatorio para operar.
 * Retorna avisos de configuracao fraca (nao bloqueantes) para serem logados.
 */
export function assertRequiredEnv(): string[] {
  const warnings: string[] = [];
  if (getJwtSecret().length < RECOMMENDED_JWT_SECRET_LENGTH) {
    warnings.push(
      `SECRET_KEY tem menos de ${RECOMMENDED_JWT_SECRET_LENGTH} caracteres; gere um segredo mais forte (ex.: openssl rand -hex 32).`,
    );
  }
  return warnings;
}

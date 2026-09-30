/**
 * Regras puras do perfil profissional (sem acesso a banco).
 */
import { HttpError } from "../../errors/HttpError";

/** Mantem apenas digitos (remove pontos, tracos e barras). */
export function onlyDigits(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const digits = String(value).replace(/\D/g, "");
  return digits || undefined;
}

/** Exige CPF (11 digitos) ou CNPJ (14 digitos); pelo menos um. */
export function parseDocuments(input: { cpf?: unknown; cnpj?: unknown }) {
  const cpf = onlyDigits(input.cpf);
  const cnpj = onlyDigits(input.cnpj);
  if (!cpf && !cnpj) throw HttpError.badRequest("CPF ou CNPJ é obrigatório");
  if (cpf && cpf.length !== 11) throw HttpError.badRequest("CPF deve ter 11 dígitos");
  if (cnpj && cnpj.length !== 14) throw HttpError.badRequest("CNPJ deve ter 14 dígitos");
  return { cpf, cnpj };
}

/** Mesmo limite da coluna professional.description (STRING(1500)). */
export const MAX_DESCRIPTION_LENGTH = 1500;

export function parseDescription(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw HttpError.badRequest("Descrição é obrigatória");
    return undefined;
  }
  const text = String(value).trim();
  if (required && !text) throw HttpError.badRequest("Descrição é obrigatória");
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    throw HttpError.badRequest(
      `Descrição deve ter no máximo ${MAX_DESCRIPTION_LENGTH} caracteres`,
    );
  }
  return text;
}

/** Raio de atuacao em km inteiros (RF04). */
export function parseRadiusKm(value: unknown): number {
  const km = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(km) || km < 0) {
    throw HttpError.badRequest("service_radius_km deve ser um número >= 0");
  }
  return Math.floor(km);
}

/** Media das notas validas, arredondada para `decimals` casas. */
export function averageRating(
  ratings: Array<number | null | undefined>,
  decimals = 1,
): { rating: number; ratings_count: number } {
  const valid = ratings.filter((r): r is number => typeof r === "number" && Number.isFinite(r));
  if (valid.length === 0) return { rating: 0, ratings_count: 0 };
  const factor = 10 ** decimals;
  const avg = valid.reduce((sum, r) => sum + r, 0) / valid.length;
  return { rating: Math.round(avg * factor) / factor, ratings_count: valid.length };
}

/** Converte "lat"/"lng" de query string em numero, ou undefined. */
export function parseOptionalCoordinate(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Data AAAA-MM-DD valida. */
export function parseIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw HttpError.badRequest("Formato de data inválido. Use AAAA-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw HttpError.badRequest("Formato de data inválido. Use AAAA-MM-DD.");
  }
  return value;
}

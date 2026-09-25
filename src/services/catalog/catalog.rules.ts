/**
 * Regras puras do catalogo de servicos (sem acesso a banco).
 */
import { HttpError } from "../../errors/HttpError";

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

/** Paginacao 1-based com limite maximo. */
export function parsePagination(
  rawPage: unknown,
  rawLimit: unknown,
  defaults: { limit: number; maxLimit: number },
): Pagination {
  const page = Math.max(1, Math.floor(Number(rawPage)) || 1);
  const limit = Math.min(
    defaults.maxLimit,
    Math.max(1, Math.floor(Number(rawLimit)) || defaults.limit),
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function parsePositiveId(value: unknown, field = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw HttpError.badRequest(`${field} inválido`);
  }
  return id;
}

/** Id opcional vindo de query string: invalido ou ausente vira undefined. */
export function optionalPositiveId(value: unknown): number | undefined {
  const id = Number(value);
  return value !== undefined && Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Preco em reais e em centavos, mantidos sincronizados.
 * price_cents tem precedencia sobre price quando ambos vierem.
 * Retorna undefined quando nenhum dos dois foi informado.
 */
export function resolvePrice(body: {
  price?: unknown;
  price_cents?: unknown;
}): { price: number; price_cents: number } | undefined {
  if (body.price_cents !== undefined && body.price_cents !== null) {
    const cents = Math.round(Number(body.price_cents));
    if (!Number.isFinite(cents) || cents < 0) {
      throw HttpError.badRequest("price_cents deve ser um inteiro >= 0");
    }
    return { price: cents / 100, price_cents: cents };
  }
  if (body.price !== undefined && body.price !== null) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw HttpError.badRequest("price deve ser um número >= 0");
    }
    return { price, price_cents: Math.round(price * 100) };
  }
  return undefined;
}

export interface AvailabilityInput {
  day: unknown;
  start: unknown;
  end: unknown;
}

/** Converte o formato da API ({ day, start, end }) em linhas do banco. */
export function toAvailabilityRows(serviceId: number, availabilities: AvailabilityInput[]) {
  return availabilities.map((a) => ({
    service_id: serviceId,
    day_of_week: Number(a.day),
    start_time: String(a.start),
    end_time: String(a.end),
  }));
}

/** O banco pode devolver TIME como "09:00:00"; a API expoe "09:00". */
export function normalizeTime(time: string): string {
  return time ? time.slice(0, 5) : time;
}

export function normalizeAvailabilities(
  availabilities: Array<{ id: number; day_of_week: number; start_time: string; end_time: string }>,
) {
  return availabilities.map((a) => ({
    id: a.id,
    day_of_week: a.day_of_week,
    start_time: normalizeTime(a.start_time),
    end_time: normalizeTime(a.end_time),
  }));
}

/** Texto usado para indexar o servico na busca semantica. */
export function semanticDocument(service: {
  title?: string | null;
  description?: string | null;
  Subcategory?: { title?: string | null; Category?: { title?: string | null } | null } | null;
}): string {
  return [
    service.title,
    service.description,
    service.Subcategory?.title,
    service.Subcategory?.Category?.title,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(". ");
}

/**
 * Limitador simples para evitar criacao duplicada (duplo clique) de
 * servicos pelo mesmo profissional. Entradas antigas sao descartadas.
 */
export class CooldownTracker {
  private readonly last = new Map<number, number>();

  constructor(private readonly windowMs: number) {}

  /** Retorna os segundos restantes, ou 0 se a acao esta liberada (e registra). */
  hit(key: number, now = Date.now()): number {
    const lastAt = this.last.get(key);
    if (lastAt !== undefined && now - lastAt < this.windowMs) {
      return Math.ceil((this.windowMs - (now - lastAt)) / 1000);
    }
    this.last.set(key, now);
    if (this.last.size > 1000) this.prune(now);
    return 0;
  }

  private prune(now: number) {
    for (const [key, at] of this.last) {
      if (now - at >= this.windowMs) this.last.delete(key);
    }
  }
}

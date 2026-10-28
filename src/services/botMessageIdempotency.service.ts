interface CachedBotMessage<T> {
  expiresAt: number;
  pending?: Promise<T>;
  result?: T;
}

export interface IdempotentExecution<T> {
  result: T;
  replayed: boolean;
}

const configuredTtlMs = Number(process.env.BOT_MESSAGE_IDEMPOTENCY_TTL_MS ?? 10 * 60 * 1000);
const CACHE_TTL_MS = Number.isFinite(configuredTtlMs)
  ? Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, configuredTtlMs))
  : 10 * 60 * 1000;

const configuredMaxEntries = Number(process.env.BOT_MESSAGE_IDEMPOTENCY_MAX_ENTRIES ?? 10_000);
const MAX_ENTRIES = Number.isFinite(configuredMaxEntries)
  ? Math.min(100_000, Math.max(100, Math.floor(configuredMaxEntries)))
  : 10_000;

export class BotMessageIdempotencyStore {
  private readonly messages = new Map<string, CachedBotMessage<unknown>>();

  private removeExpired(now: number): void {
    for (const [key, entry] of this.messages) {
      if (entry.expiresAt <= now) this.messages.delete(key);
    }
  }

  private makeKey(userId: number, idempotencyKey: string): string {
    return `bot-message:${userId}:${idempotencyKey}`;
  }

  public async execute<T>(
    userId: number,
    idempotencyKey: string,
    operation: () => Promise<T>,
  ): Promise<IdempotentExecution<T>> {
    const now = Date.now();
    this.removeExpired(now);

    const key = this.makeKey(userId, idempotencyKey);
    const existing = this.messages.get(key) as CachedBotMessage<T> | undefined;
    if (existing) {
      if (existing.pending) {
        return { result: await existing.pending, replayed: true };
      }
      if (existing.result !== undefined) {
        return { result: existing.result, replayed: true };
      }
    }

    if (this.messages.size >= MAX_ENTRIES) {
      for (const [oldestKey, candidate] of this.messages) {
        if (!candidate.pending) {
          this.messages.delete(oldestKey);
          break;
        }
      }
    }

    const entry: CachedBotMessage<T> = { expiresAt: now + CACHE_TTL_MS };
    const pending = operation()
      .then((result) => {
        entry.pending = undefined;
        entry.result = result;
        return result;
      })
      .catch((error) => {
        if (this.messages.get(key) === entry) this.messages.delete(key);
        throw error;
      });
    entry.pending = pending;
    this.messages.set(key, entry);

    return { result: await pending, replayed: false };
  }

  public clear(): void {
    this.messages.clear();
  }
}

export const botMessageIdempotencyStore = new BotMessageIdempotencyStore();

export function getBotMessageIdempotencyKey(
  headerValue: string | undefined,
  bodyValue?: unknown,
): string | undefined | null {
  const candidate =
    typeof headerValue === "string" && headerValue.trim().length > 0
      ? headerValue
      : typeof bodyValue === "string" && bodyValue.trim().length > 0
        ? bodyValue
        : undefined;

  if (candidate === undefined) return undefined;
  const key = candidate.trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
}

interface CachedVoiceCommand<T> {
  expiresAt: number;
  pending?: Promise<T>;
  result?: T;
}

export interface IdempotentExecution<T> {
  result: T;
  replayed: boolean;
}

const configuredTtlMs = Number(process.env.VOICE_COMMAND_IDEMPOTENCY_TTL_MS ?? 10 * 60 * 1000);
const CACHE_TTL_MS = Number.isFinite(configuredTtlMs)
  ? Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, configuredTtlMs))
  : 10 * 60 * 1000;

const configuredMaxEntries = Number(process.env.VOICE_COMMAND_IDEMPOTENCY_MAX_ENTRIES ?? 10_000);
const MAX_ENTRIES = Number.isFinite(configuredMaxEntries)
  ? Math.min(100_000, Math.max(100, Math.floor(configuredMaxEntries)))
  : 10_000;

/**
 * Guarda o resultado de comandos de voz por pouco tempo para que uma repetição
 * de rede não crie dois agendamentos. Em múltiplas instâncias, configure uma
 * implementação compartilhada (por exemplo Redis) antes de depender dessa
 * garantia entre processos.
 */
export class VoiceCommandIdempotencyStore {
  private readonly commands = new Map<string, CachedVoiceCommand<unknown>>();

  private removeExpired(now: number): void {
    for (const [key, entry] of this.commands) {
      if (entry.expiresAt <= now) this.commands.delete(key);
    }
  }

  private makeKey(userId: number, idempotencyKey: string): string {
    return `voice-command:${userId}:${idempotencyKey}`;
  }

  public async execute<T>(
    userId: number,
    idempotencyKey: string,
    operation: () => Promise<T>,
  ): Promise<IdempotentExecution<T>> {
    const now = Date.now();
    this.removeExpired(now);

    const key = this.makeKey(userId, idempotencyKey);
    const existing = this.commands.get(key) as CachedVoiceCommand<T> | undefined;
    if (existing) {
      if (existing.pending) {
        return { result: await existing.pending, replayed: true };
      }
      if (existing.result !== undefined) {
        return { result: existing.result, replayed: true };
      }
    }

    if (this.commands.size >= MAX_ENTRIES) {
      // Nunca remover uma operação em andamento: isso abriria espaço para duas
      // execuções simultâneas da mesma chave. Se todas estiverem pendentes, o
      // mapa pode exceder o limite temporariamente até elas terminarem.
      for (const [oldestKey, candidate] of this.commands) {
        if (!candidate.pending) {
          this.commands.delete(oldestKey);
          break;
        }
      }
    }

    const entry: CachedVoiceCommand<T> = { expiresAt: now + CACHE_TTL_MS };
    const pending = operation()
      .then((result) => {
        entry.pending = undefined;
        entry.result = result;
        return result;
      })
      .catch((error) => {
        // Não cachear falha: o cliente pode tentar de novo com a mesma chave.
        if (this.commands.get(key) === entry) this.commands.delete(key);
        throw error;
      });
    entry.pending = pending;
    this.commands.set(key, entry);

    return { result: await pending, replayed: false };
  }
}

export const voiceCommandIdempotencyStore = new VoiceCommandIdempotencyStore();

/** A chave é opaca, mas limitada para não consumir memória nem aceitar quebras de linha. */
export function getVoiceCommandIdempotencyKey(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const key = value.trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
}

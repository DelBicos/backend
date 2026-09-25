/**
 * Cadastros aguardando confirmacao do codigo enviado por e-mail.
 *
 * Mantido em memoria (o App Service F1 roda uma unica instancia). A senha
 * ja chega aqui com hash; codigos expiram e ha limite de tentativas para
 * impedir forca bruta no codigo de 6 digitos.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
const MAX_ACTIVE_CODES = 3;

export interface PendingUserData {
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  cpf: string;
  address: Record<string, any>;
}

interface Entry {
  data: PendingUserData;
  codes: Array<{ value: string; expiresAt: number }>;
  attempts: number;
}

export type VerifyResult =
  | { status: "ok"; data: PendingUserData }
  | { status: "not_found" }
  | { status: "invalid"; attemptsLeft: number }
  | { status: "locked" };

export class PendingRegistrationStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Inicia (ou reinicia) o cadastro pendente com um novo codigo. */
  start(email: string, data: PendingUserData, code: string): void {
    this.prune();
    this.entries.set(email, {
      data,
      codes: [{ value: code, expiresAt: this.now() + CODE_TTL_MS }],
      attempts: 0,
    });
  }

  /** Dados do cadastro pendente, se ainda houver codigo valido. */
  get(email: string): PendingUserData | undefined {
    return this.alive(email)?.data;
  }

  /** Adiciona um novo codigo (reenvio). Retorna false se o cadastro expirou. */
  addCode(email: string, code: string): boolean {
    const entry = this.alive(email);
    if (!entry) return false;
    entry.codes = [
      ...entry.codes,
      { value: code, expiresAt: this.now() + CODE_TTL_MS },
    ].slice(-MAX_ACTIVE_CODES);
    return true;
  }

  verify(email: string, code: string): VerifyResult {
    const entry = this.alive(email);
    if (!entry) return { status: "not_found" };

    const now = this.now();
    if (entry.codes.some((c) => c.value === code && c.expiresAt > now)) {
      return { status: "ok", data: entry.data };
    }

    entry.attempts += 1;
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      this.entries.delete(email);
      return { status: "locked" };
    }
    return { status: "invalid", attemptsLeft: MAX_VERIFY_ATTEMPTS - entry.attempts };
  }

  delete(email: string): void {
    this.entries.delete(email);
  }

  get size(): number {
    return this.entries.size;
  }

  private alive(email: string): Entry | undefined {
    const entry = this.entries.get(email);
    if (!entry) return undefined;
    const now = this.now();
    entry.codes = entry.codes.filter((c) => c.expiresAt > now);
    if (entry.codes.length === 0) {
      this.entries.delete(email);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    for (const email of [...this.entries.keys()]) this.alive(email);
  }
}

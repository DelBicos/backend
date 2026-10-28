import {
  BotMessageIdempotencyStore,
  getBotMessageIdempotencyKey,
} from "../botMessageIdempotency.service";

describe("BotMessageIdempotencyStore", () => {
  it("executa uma operação pela primeira vez e reutiliza o resultado na segunda", async () => {
    const store = new BotMessageIdempotencyStore();
    const operation = jest.fn().mockResolvedValue({ message: "agendamento confirmado", appointmentId: 42 });

    const first = await store.execute(1, "idem-key-12345", operation);
    const second = await store.execute(1, "idem-key-12345", operation);

    expect(first).toEqual({
      result: { message: "agendamento confirmado", appointmentId: 42 },
      replayed: false,
    });
    expect(second).toEqual({
      result: { message: "agendamento confirmado", appointmentId: 42 },
      replayed: true,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("não compartilha chaves entre usuários diferentes", async () => {
    const store = new BotMessageIdempotencyStore();
    const operation = jest.fn().mockResolvedValue({ status: "ok" });

    await store.execute(1, "idem-key-12345", operation);
    await store.execute(2, "idem-key-12345", operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("aguarda operação em andamento sem duplicar a execução concorrente", async () => {
    const store = new BotMessageIdempotencyStore();
    let resolveOp: (val: any) => void;
    const slowOp = jest.fn().mockImplementation(() => new Promise((resolve) => {
      resolveOp = resolve;
    }));

    const promise1 = store.execute(1, "concurrent-key-1234", slowOp);
    const promise2 = store.execute(1, "concurrent-key-1234", slowOp);

    resolveOp!({ done: true });

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toEqual({ result: { done: true }, replayed: false });
    expect(res2).toEqual({ result: { done: true }, replayed: true });
    expect(slowOp).toHaveBeenCalledTimes(1);
  });

  it("não armazena resultado em caso de erro, permitindo retry", async () => {
    const store = new BotMessageIdempotencyStore();
    const failingOp = jest.fn().mockRejectedValue(new Error("falha de rede"));
    const successOp = jest.fn().mockResolvedValue({ ok: true });

    await expect(store.execute(1, "fail-then-retry-123", failingOp)).rejects.toThrow("falha de rede");

    const retryRes = await store.execute(1, "fail-then-retry-123", successOp);
    expect(retryRes).toEqual({ result: { ok: true }, replayed: false });
    expect(successOp).toHaveBeenCalledTimes(1);
  });
});

describe("getBotMessageIdempotencyKey", () => {
  it("extrai do header ou do body", () => {
    expect(getBotMessageIdempotencyKey(undefined, undefined)).toBeUndefined();
    expect(getBotMessageIdempotencyKey("header-key-1234", undefined)).toBe("header-key-1234");
    expect(getBotMessageIdempotencyKey(undefined, "body-key-1234")).toBe("body-key-1234");
    expect(getBotMessageIdempotencyKey("header-key-1234", "body-key-5678")).toBe("header-key-1234");
  });

  it("rejeita chaves inválidas ou fora do tamanho seguro (8-128 chars)", () => {
    expect(getBotMessageIdempotencyKey("curta")).toBeNull();
    expect(getBotMessageIdempotencyKey("key com espaços")).toBeNull();
    expect(getBotMessageIdempotencyKey("key\ncom\nquebra")).toBeNull();
    expect(getBotMessageIdempotencyKey("a".repeat(129))).toBeNull();
    expect(getBotMessageIdempotencyKey("a".repeat(8))).toBe("a".repeat(8));
  });
});

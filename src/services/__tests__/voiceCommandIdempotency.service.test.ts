import {
  VoiceCommandIdempotencyStore,
  getVoiceCommandIdempotencyKey,
} from "../voiceCommandIdempotency.service";

describe("VoiceCommandIdempotencyStore", () => {
  it("executa uma única vez chamadas simultâneas com a mesma chave e usuário", async () => {
    const store = new VoiceCommandIdempotencyStore();
    let executions = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const operation = async () => {
      executions += 1;
      await pending;
      return { session_id: 10 };
    };

    const first = store.execute(5, "voice-command-key-5", operation);
    const replay = store.execute(5, "voice-command-key-5", operation);
    release();

    await expect(first).resolves.toEqual({ result: { session_id: 10 }, replayed: false });
    await expect(replay).resolves.toEqual({ result: { session_id: 10 }, replayed: true });
    expect(executions).toBe(1);
  });

  it("não compartilha uma chave entre usuários diferentes", async () => {
    const store = new VoiceCommandIdempotencyStore();
    const operation = jest.fn().mockResolvedValue({ ok: true });

    await store.execute(1, "voice-command-key-1", operation);
    await store.execute(2, "voice-command-key-1", operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("aceita apenas chaves de cabeçalho seguras", () => {
    expect(getVoiceCommandIdempotencyKey(undefined)).toBeUndefined();
    expect(getVoiceCommandIdempotencyKey("voice-key-123")).toBe("voice-key-123");
    expect(getVoiceCommandIdempotencyKey("curta")).toBeNull();
    expect(getVoiceCommandIdempotencyKey("key\ninvalid")).toBeNull();
  });
});

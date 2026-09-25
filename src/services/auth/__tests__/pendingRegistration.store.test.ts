import {
  CODE_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  PendingRegistrationStore,
  PendingUserData,
} from "../pendingRegistration.store";

const data: PendingUserData = {
  name: "Ana Souza",
  email: "ana@x.com",
  passwordHash: "$2a$hash",
  cpf: "12345678901",
  address: {},
};

describe("PendingRegistrationStore", () => {
  let now: number;
  let store: PendingRegistrationStore;

  beforeEach(() => {
    now = 1_000_000;
    store = new PendingRegistrationStore(() => now);
  });

  it("valida o codigo correto dentro do prazo", () => {
    store.start("ana@x.com", data, "123456");
    expect(store.verify("ana@x.com", "123456")).toEqual({ status: "ok", data });
  });

  it("expira o cadastro junto com o ultimo codigo", () => {
    store.start("ana@x.com", data, "123456");
    now += CODE_TTL_MS;
    expect(store.verify("ana@x.com", "123456")).toEqual({ status: "not_found" });
    expect(store.size).toBe(0);
  });

  it("bloqueia apos o limite de tentativas invalidas (anti forca bruta)", () => {
    store.start("ana@x.com", data, "123456");
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) {
      expect(store.verify("ana@x.com", "000000")).toEqual({
        status: "invalid",
        attemptsLeft: MAX_VERIFY_ATTEMPTS - i,
      });
    }
    expect(store.verify("ana@x.com", "000000")).toEqual({ status: "locked" });
    // Mesmo o codigo correto nao funciona mais: precisa recomecar o cadastro.
    expect(store.verify("ana@x.com", "123456")).toEqual({ status: "not_found" });
  });

  it("reenvio adiciona codigo novo mantendo o anterior valido", () => {
    store.start("ana@x.com", data, "111111");
    now += 1000;
    expect(store.addCode("ana@x.com", "222222")).toBe(true);
    expect(store.verify("ana@x.com", "111111").status).toBe("ok");
    expect(store.verify("ana@x.com", "222222").status).toBe("ok");
  });

  it("reenvio falha para cadastro inexistente ou expirado", () => {
    expect(store.addCode("ninguem@x.com", "123456")).toBe(false);
    store.start("ana@x.com", data, "111111");
    now += CODE_TTL_MS + 1;
    expect(store.addCode("ana@x.com", "222222")).toBe(false);
  });

  it("mantem no maximo 3 codigos ativos", () => {
    store.start("ana@x.com", data, "000001");
    store.addCode("ana@x.com", "000002");
    store.addCode("ana@x.com", "000003");
    store.addCode("ana@x.com", "000004");
    expect(store.verify("ana@x.com", "000001").status).toBe("invalid");
    expect(store.verify("ana@x.com", "000004").status).toBe("ok");
  });
});

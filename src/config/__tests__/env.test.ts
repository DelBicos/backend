import {
  assertRequiredEnv,
  getJwtExpiresIn,
  getJwtSecret,
  isProduction,
  MissingEnvError,
  RECOMMENDED_JWT_SECRET_LENGTH,
} from "../env";
import { getStripe, resetStripeClient } from "../stripe";

const KEYS = ["SECRET_KEY", "EXPIRES_IN", "ENVIRONMENT", "NODE_ENV", "STRIPE_SECRET_KEY"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeAll(() => {
  for (const key of KEYS) saved[key] = process.env[key];
});

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetStripeClient();
});

describe("config/env", () => {
  it("lanca MissingEnvError sem SECRET_KEY", () => {
    expect(() => getJwtSecret()).toThrow(MissingEnvError);
    try {
      getJwtSecret();
    } catch (error) {
      expect((error as Error).name).toBe("MissingEnvError");
      expect((error as Error).message).toContain("SECRET_KEY");
    }
  });

  it("le o segredo e a expiracao, com 1h por padrao", () => {
    process.env.SECRET_KEY = "segredo";
    expect(getJwtSecret()).toBe("segredo");
    expect(getJwtExpiresIn()).toBe("1h");
    process.env.EXPIRES_IN = "7d";
    expect(getJwtExpiresIn()).toBe("7d");
  });

  it("detecta producao por ENVIRONMENT ou NODE_ENV", () => {
    expect(isProduction()).toBe(false);
    process.env.NODE_ENV = "production";
    expect(isProduction()).toBe(true);
    process.env.ENVIRONMENT = "staging";
    expect(isProduction()).toBe(false);
  });

  it("avisa quando o segredo e curto e nao avisa quando e forte", () => {
    process.env.SECRET_KEY = "curto";
    expect(assertRequiredEnv()).toEqual([expect.stringContaining("SECRET_KEY tem menos de")]);
    process.env.SECRET_KEY = "x".repeat(RECOMMENDED_JWT_SECRET_LENGTH);
    expect(assertRequiredEnv()).toEqual([]);
  });
});

describe("config/stripe", () => {
  beforeEach(() => resetStripeClient());

  it("exige uma chave secreta sk_", () => {
    expect(() => getStripe()).toThrow(MissingEnvError);
    process.env.STRIPE_SECRET_KEY = "pk_test_publica";
    expect(() => getStripe()).toThrow(MissingEnvError);
  });

  it("cria o cliente uma vez e reaproveita ate o reset", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const first = getStripe();
    expect(getStripe()).toBe(first);
    resetStripeClient();
    expect(getStripe()).not.toBe(first);
  });
});

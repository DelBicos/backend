import nodemailer from "nodemailer";
import { getSenderAddress, getSmtpTransporter, readSmtpConfig } from "../mailer";

describe("readSmtpConfig", () => {
  it("fica desligado sem usuário ou senha", () => {
    expect(readSmtpConfig({})).toBeNull();
    expect(readSmtpConfig({ SMTP_USER: "a@gmail.com" })).toBeNull();
  });

  it("usa Gmail na porta 587 com STARTTLS por padrão e tira espaços da senha de app", () => {
    expect(readSmtpConfig({ SMTP_USER: "a@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" })).toEqual({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "a@gmail.com",
      pass: "abcdefghijklmnop",
    });
  });

  it("usa TLS direto na porta 465", () => {
    const config = readSmtpConfig({ SMTP_USER: "a", SMTP_PASS: "b", SMTP_PORT: "465" });
    expect(config?.secure).toBe(true);
  });

  it("ignora porta inválida", () => {
    expect(readSmtpConfig({ SMTP_USER: "a", SMTP_PASS: "b", SMTP_PORT: "abc" })?.port).toBe(587);
  });
});

describe("getSmtpTransporter e getSenderAddress", () => {
  const KEYS = ["SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SENDER_EMAIL_VERIFICADO", "SENDER_NAME"] as const;
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
    jest.restoreAllMocks();
  });

  it("nao cria transporte sem credenciais SMTP", () => {
    expect(getSmtpTransporter()).toBeNull();
  });

  it("reaproveita o transporte enquanto a configuracao nao muda", () => {
    const createTransport = jest.spyOn(nodemailer, "createTransport");
    process.env.SMTP_USER = "conta@gmail.com";
    process.env.SMTP_PASS = "abcd efgh";
    const first = getSmtpTransporter();
    expect(first).not.toBeNull();
    expect(getSmtpTransporter()).toBe(first);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true }),
    );

    process.env.SMTP_PORT = "465";
    const second = getSmtpTransporter();
    expect(second).not.toBe(first);
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true, requireTLS: false }));
  });

  it("monta o remetente a partir do e-mail verificado ou da conta SMTP", () => {
    expect(getSenderAddress()).toBeNull();
    process.env.SMTP_USER = "conta@gmail.com";
    expect(getSenderAddress()).toBe('"DelBicos" <conta@gmail.com>');
    process.env.SENDER_EMAIL_VERIFICADO = "noreply@delbicos.com";
    process.env.SENDER_NAME = 'Equipe "Del"';
    expect(getSenderAddress()).toBe('"Equipe Del" <noreply@delbicos.com>');
  });
});

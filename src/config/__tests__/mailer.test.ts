import { readSmtpConfig } from "../mailer";

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

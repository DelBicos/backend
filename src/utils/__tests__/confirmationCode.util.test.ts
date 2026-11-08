import {
  confirmationCodesMatch,
  generateConfirmationCode,
  isValidConfirmationCodeFormat,
} from "../confirmationCode.util";

describe("confirmationCode.util (CHK-01)", () => {
  it("deve gerar códigos válidos no formato AB-12", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateConfirmationCode();
      expect(code).toMatch(/^[A-Z]{2}-[0-9]{2}$/);
      expect(isValidConfirmationCodeFormat(code)).toBe(true);
    }
  });

  it("deve validar corretamente o formato AB-12", () => {
    expect(isValidConfirmationCodeFormat("AB-12")).toBe(true);
    expect(isValidConfirmationCodeFormat("ZZ-99")).toBe(true);
    expect(isValidConfirmationCodeFormat("ab-12")).toBe(false); // case-sensitive
    expect(isValidConfirmationCodeFormat("AB12")).toBe(false); // sem hífen
    expect(isValidConfirmationCodeFormat("12-AB")).toBe(false);
    expect(isValidConfirmationCodeFormat("")).toBe(false);
  });

  it("deve comparar códigos de forma case-sensitive (CHK-03/CHK-04)", () => {
    expect(confirmationCodesMatch("AB-12", "AB-12")).toBe(true);
    expect(confirmationCodesMatch("ab-12", "AB-12")).toBe(false);
    expect(confirmationCodesMatch("Ab-12", "AB-12")).toBe(false);
    expect(confirmationCodesMatch("XY-99", "AB-12")).toBe(false);
  });

  it("deve ignorar o hífen e espaços na comparação", () => {
    expect(confirmationCodesMatch("AB12", "AB-12")).toBe(true);
    expect(confirmationCodesMatch(" AB-12 ", "AB-12")).toBe(true);
  });

  it("deve aceitar códigos legados de 4 dígitos digitados no formato do app", () => {
    expect(confirmationCodesMatch("12-34", "1234")).toBe(true);
    expect(confirmationCodesMatch("12-35", "1234")).toBe(false);
  });

  it("deve recusar entrada vazia ou de tipo inválido", () => {
    expect(confirmationCodesMatch("", "")).toBe(false);
    expect(confirmationCodesMatch(undefined, "AB-12")).toBe(false);
    expect(confirmationCodesMatch(1234, "1234")).toBe(false);
    expect(confirmationCodesMatch("AB-12", null)).toBe(false);
  });
});

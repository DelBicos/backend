import { generateTicketCode } from "../ticketCode";

describe("ticketCode.util (TICKET-01)", () => {
  it("deve gerar códigos no formato TKT-XXXX", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTicketCode()).toMatch(/^TKT-[A-Z0-9]{4}$/);
    }
  });

  it("não deve usar caracteres ambíguos (0, O, 1, I)", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateTicketCode().slice(4)).not.toMatch(/[0O1I]/);
    }
  });

  it("deve variar entre chamadas", () => {
    const codes = new Set(Array.from({ length: 200 }, generateTicketCode));
    expect(codes.size).toBeGreaterThan(190);
  });
});

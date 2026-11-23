import { acceptsNewMessages, OPEN_TICKET_STATUSES } from "../ticket.rules";

describe("ticket.rules acceptsNewMessages (TICKET-05)", () => {
  it.each(["ABERTO", "EM_ANALISE", "EM_ATENDIMENTO"] as const)("aceita mensagens com status %s", (status) => {
    expect(acceptsNewMessages(status)).toBe(true);
  });

  it.each(["RESOLVIDO", "FECHADO"] as const)("recusa mensagens com status %s", (status) => {
    expect(acceptsNewMessages(status)).toBe(false);
  });

  it("considera em aberto exatamente os três status de atendimento", () => {
    expect(OPEN_TICKET_STATUSES).toEqual(["ABERTO", "EM_ANALISE", "EM_ATENDIMENTO"]);
  });
});

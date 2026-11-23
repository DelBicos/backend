import {
  acceptsNewMessages,
  buildTicketTitleFromDescription,
  inferTicketCategory,
  OPEN_TICKET_STATUSES,
} from "../ticket.rules";

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

describe("ticket.rules inferTicketCategory (chatbot)", () => {
  it.each([
    ["Fui cobrado duas vezes pelo agendamento de ontem", "PAGAMENTO"],
    ["O PIX não caiu e o app pede para pagar de novo", "PAGAMENTO"],
    ["O prestador não apareceu no horário combinado", "PRESTADOR"],
    ["Meu agendamento sumiu da lista", "AGENDAMENTO"],
    ["O serviço ficou mal feito e quebraram meu armário", "SERVICO"],
    ["Não consigo acessar minha conta desde ontem", "CLIENTE"],
    ["Tenho uma sugestão de melhoria para o app", "SUGESTAO"],
    ["O aplicativo fecha sozinho quando eu abro", "OUTROS"],
  ] as const)("classifica %p como %s", (description, category) => {
    expect(inferTicketCategory(description)).toBe(category);
  });
});

describe("ticket.rules buildTicketTitleFromDescription (chatbot)", () => {
  it("usa a descrição inteira em uma linha quando cabe no título", () => {
    expect(buildTicketTitleFromDescription("  O app travou\n  ao pagar  ")).toBe("O app travou ao pagar");
  });

  it("corta descrições longas em uma palavra e respeita 100 caracteres", () => {
    const title = buildTicketTitleFromDescription(`${"palavra ".repeat(30)}fim`);
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith("palavra...")).toBe(true);
  });
});

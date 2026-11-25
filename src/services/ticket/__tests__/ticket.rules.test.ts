import {
  acceptsNewMessages,
  buildChatbotTicket,
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

describe("ticket.rules buildChatbotTicket (chatbot)", () => {
  it("usa o resumo como título e junta os detalhes à descrição", () => {
    expect(
      buildChatbotTicket("Fui cobrado duas vezes no meu cartão", "Foi ontem, no agendamento 6BDOKZ")
    ).toEqual({
      title: "Fui cobrado duas vezes no meu cartão",
      description: "Fui cobrado duas vezes no meu cartão\n\nDetalhes: Foi ontem, no agendamento 6BDOKZ",
      category: "PAGAMENTO",
      priority: "MEDIA",
    });
  });

  it("usa só o resumo quando não há detalhes", () => {
    const draft = buildChatbotTicket("O aplicativo fecha sozinho ao abrir");

    expect(draft.description).toBe("O aplicativo fecha sozinho ao abrir");
    expect(draft.category).toBe("OUTROS");
  });

  it("infere a categoria também pelos detalhes", () => {
    expect(buildChatbotTicket("Tive um problema ontem", "O prestador não apareceu").category).toBe(
      "PRESTADOR"
    );
  });

  it("limita a descrição a 2000 caracteres", () => {
    expect(buildChatbotTicket("Resumo do problema", "x".repeat(3000)).description).toHaveLength(2000);
  });
});

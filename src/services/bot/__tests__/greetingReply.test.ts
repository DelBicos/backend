import { buildGreetingReply } from "../greetingReply";

describe("buildGreetingReply", () => {
  it("retoma a pergunta de data sem perder o serviço", () => {
    const reply = buildGreetingReply("COLETANDO_DATA", {
      serviceName: "Limpeza residencial",
      pendingAction: "CREATE",
    });

    expect(reply).toContain("Olá!");
    expect(reply).toContain("Limpeza residencial");
    expect(reply).toContain("Qual dia");
  });

  it("retoma a seleção de profissional depois de data e horário", () => {
    const reply = buildGreetingReply("SELECIONANDO_PROFISSIONAL", {
      serviceName: "Limpeza residencial",
      date: "2026-08-25",
      time: "14:00",
    });

    expect(reply).toContain("Olá!");
    expect(reply).toContain("escolha um dos profissionais");
  });
});

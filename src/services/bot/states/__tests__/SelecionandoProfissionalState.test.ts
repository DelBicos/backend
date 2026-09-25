import type { BotChatSessionModel } from "../../../../models/BotChatSession";
import { SelecionandoProfissionalState } from "../SelecionandoProfissionalState";

describe("SelecionandoProfissionalState", () => {
  it("avança para a confirmação ao escolher um profissional", async () => {
    const result = await new SelecionandoProfissionalState().handle(
      "2",
      { intent: "FALLBACK", entities: {}, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          date: "2026-08-25",
          time: "14:00",
          professionalOptionsData: [
            {
              index: 1,
              serviceId: 10,
              professionalId: 100,
              professionalName: "Ana",
              price: 10000,
              duration: 30,
              time: "14:00",
            },
            {
              index: 2,
              serviceId: 11,
              professionalId: 101,
              professionalName: "Bruno",
              price: 12000,
              duration: 60,
              time: "14:00",
            },
          ],
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("CONFIRMACAO");
    expect(result.contextUpdate).toMatchObject({
      serviceId: 11,
      professionalId: 101,
      professionalName: "Bruno",
      serviceDuration: 60,
      servicePrice: 12000,
    });
    expect(result.reply).toContain("Resumo do agendamento");
    expect(result.reply).toContain("Bruno");
  });

  it.each(["confirmar", "sim", "pode ser"])(
    "trata %p como seleção da única opção disponível",
    async (message) => {
      const result = await new SelecionandoProfissionalState().handle(
        message,
        { intent: "FALLBACK", entities: {}, confidence: 1 },
        {
          context: {
            pendingAction: "CREATE",
            serviceName: "Montagem de Móveis",
            date: "2026-08-28",
            time: "15:30",
            professionalOptionsData: [
              {
                index: 1,
                serviceId: 10,
                professionalId: 100,
                professionalName: "Iago Silva",
                price: 10000,
                duration: 120,
                time: "15:30",
              },
            ],
          },
        } as BotChatSessionModel,
        1,
      );

      expect(result.nextState).toBe("CONFIRMACAO");
      expect(result.contextUpdate).toMatchObject({
        serviceId: 10,
        professionalId: 100,
        professionalName: "Iago Silva",
        serviceDuration: 120,
        servicePrice: 10000,
        time: "15:30",
      });
      expect(result.reply).toContain("Resumo do agendamento");
      expect(result.reply).toContain("Iago Silva");
    },
  );

  it("não escolhe arbitrariamente um profissional ao receber confirmar com várias opções", async () => {
    const result = await new SelecionandoProfissionalState().handle(
      "confirmar",
      { intent: "FALLBACK", entities: {}, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          date: "2026-08-25",
          time: "14:00",
          professionalOptionsData: [
            {
              index: 1,
              serviceId: 10,
              professionalId: 100,
              professionalName: "Ana",
              price: 10000,
              duration: 30,
              time: "14:00",
            },
            {
              index: 2,
              serviceId: 11,
              professionalId: 101,
              professionalName: "Bruno",
              price: 12000,
              duration: 60,
              time: "14:00",
            },
          ],
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("SELECIONANDO_PROFISSIONAL");
    expect(result.contextUpdate).toEqual({});
    expect(result.reply).toContain("Há mais de um profissional disponível");
    expect(result.reply).toContain("1. Ana");
    expect(result.reply).toContain("2. Bruno");
  });
});

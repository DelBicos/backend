jest.mock("../../../../models/Professional", () => ({ ProfessionalModel: {} }));
jest.mock("../../../../models/Service", () => ({
  ServiceModel: { findAll: jest.fn() },
}));
jest.mock("../../../../models/User", () => ({ UserModel: {} }));
jest.mock("../../../availability.service", () => ({
  getAvailableSlots: jest.fn(),
}));

import type { BotChatSessionModel } from "../../../../models/BotChatSession";
import { ServiceModel } from "../../../../models/Service";
import type { NluResult } from "../../../nlu.service";
import { getAvailableSlots } from "../../../availability.service";
import { ColetandoDataState } from "../ColetandoDataState";

function futureDate(daysAhead = 5): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function serviceFixture(
  id: number,
  professionalId: number,
  professionalName: string,
  duration: number,
) {
  return {
    id,
    professional_id: professionalId,
    duration,
    Professional: { User: { name: professionalName } },
  };
}

function session(matchedServiceIds: number[]): BotChatSessionModel {
  return {
    context: {
      pendingAction: "CREATE",
      serviceName: "Limpeza residencial",
      matchedServiceIds,
      timeZone: "America/Sao_Paulo",
    },
  } as BotChatSessionModel;
}

describe("ColetandoDataState", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lista somente profissionais com slots no dia e então pergunta o horário", async () => {
    const date = futureDate();
    const services = [
      serviceFixture(10, 100, "Ana", 30),
      serviceFixture(11, 101, "Bruno", 60),
      serviceFixture(12, 102, "Carla", 90),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (getAvailableSlots as jest.Mock).mockImplementation(
      async (
        _professionalId: number,
        _date: string,
        _duration: number,
        serviceId: number,
      ) => (serviceId === 11 ? [] : ["14:00"]),
    );
    const nlu: NluResult = {
      intent: "FALLBACK",
      entities: { date },
      confidence: 1,
    };

    const result = await new ColetandoDataState().handle(
      date,
      nlu,
      session([10, 11, 12]),
      1,
    );

    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.contextUpdate).toMatchObject({
      date,
      availableDayServiceIds: [10, 12],
      availableDayProfessionals: [
        { professionalId: 100, professionalName: "Ana" },
        { professionalId: 102, professionalName: "Carla" },
      ],
    });
    expect(result.reply).toContain("Ana");
    expect(result.reply).toContain("Carla");
    expect(result.reply).not.toContain("Bruno");
    expect(result.reply).toMatch(/qual horário/i);
    expect(getAvailableSlots).toHaveBeenCalledWith(100, date, 30, 10);
    expect(getAvailableSlots).toHaveBeenCalledWith(101, date, 60, 11);
    expect(getAvailableSlots).toHaveBeenCalledWith(102, date, 90, 12);
  });

  it("permanece na etapa de data e sugere próximos dias quando ninguém atende", async () => {
    const date = futureDate();
    const services = [serviceFixture(10, 100, "Ana", 30)];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (getAvailableSlots as jest.Mock).mockImplementation(
      async (_professionalId: number, candidate: string) =>
        candidate === date ? [] : ["09:00"],
    );

    const result = await new ColetandoDataState().handle(
      date,
      { intent: "FALLBACK", entities: { date }, confidence: 1 },
      session([10]),
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.contextUpdate.suggestedDates).toEqual([
      addDays(date, 1),
      addDays(date, 2),
      addDays(date, 3),
    ]);
    expect(result.contextUpdate.availableDayServiceIds).toBeUndefined();
    expect(result.contextUpdate.availableDayProfessionals).toBeUndefined();
    expect(result.reply).toContain("Não encontrei profissionais disponíveis");
    expect(result.reply).toContain("Escolha um número");
  });

  it("não confunde uma data iniciada por 1 ou 2 com o índice de uma sugestão", async () => {
    const now = new Date();
    const candidateDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const date = candidateDate.toISOString().slice(0, 10);
    const typedDate = `1/${candidateDate.getUTCMonth() + 1}/${candidateDate.getUTCFullYear()}`;
    const currentSession = session([10]);
    currentSession.context = {
      ...currentSession.context,
      suggestedDates: [addDays(date, 3), addDays(date, 4)],
    };
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00"]);

    const result = await new ColetandoDataState().handle(
      typedDate,
      { intent: "FALLBACK", entities: { date }, confidence: 1 },
      currentSession,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.contextUpdate.date).toBe(date);
  });

  it("preserva todas as ofertas do dia quando a data veio com um período", async () => {
    const date = futureDate();
    const services = [
      serviceFixture(10, 100, "Ana", 30),
      serviceFixture(11, 101, "Bruno", 60),
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (getAvailableSlots as jest.Mock).mockImplementation(
      async (
        _professionalId: number,
        _date: string,
        _duration: number,
        serviceId: number,
      ) => (serviceId === 10 ? ["09:00"] : ["14:00"]),
    );

    const result = await new ColetandoDataState().handle(
      `${date} à tarde`,
      {
        intent: "FALLBACK",
        entities: { date, time_period: "AFTERNOON" },
        confidence: 1,
      },
      session([10, 11]),
      1,
    );

    expect(result.contextUpdate.availableDayServiceIds).toEqual([10, 11]);
    expect(result.contextUpdate.availableDayProfessionals).toEqual([
      { professionalId: 101, professionalName: "Bruno" },
    ]);
    expect(result.reply).not.toContain("Ana");
    expect(result.reply).toContain("Bruno");
  });

  it("limita a lista exibida sem descartar profissionais disponíveis do contexto", async () => {
    const date = futureDate();
    const services = Array.from({ length: 8 }, (_, index) =>
      serviceFixture(20 + index, 200 + index, `Profissional ${index + 1}`, 60),
    );
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["10:00"]);

    const result = await new ColetandoDataState().handle(
      date,
      { intent: "FALLBACK", entities: { date }, confidence: 1 },
      session(services.map((service) => service.id)),
      1,
    );

    expect(result.contextUpdate.availableDayProfessionals).toHaveLength(8);
    expect(result.reply).toContain("Profissional 6");
    expect(result.reply).not.toContain("Profissional 7");
    expect(result.reply).toContain("e mais 2 profissionais");
  });
});

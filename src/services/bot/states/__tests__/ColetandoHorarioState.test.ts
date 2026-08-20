jest.mock("../../../../models/Address", () => ({ AddressModel: {} }));
jest.mock("../../../../models/Appointment", () => ({ AppointmentModel: {} }));
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
import { getAvailableSlots } from "../../../availability.service";
import { ColetandoHorarioState } from "../ColetandoHorarioState";

function futureDate(daysAhead = 5): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
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
    price_cents: 10000 + id,
    duration,
    Professional: {
      User: { name: professionalName, avatar_uri: null },
      MainAddress: { city: "São Paulo", state: "SP" },
    },
    Appointments: [],
  };
}

describe("ColetandoHorarioState", () => {
  beforeEach(() => jest.clearAllMocks());

  it("só mostra profissionais disponíveis depois de receber o horário", async () => {
    const date = futureDate();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
      serviceFixture(11, 101, "Bruno", 90),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["14:00"]);

    const result = await new ColetandoHorarioState().handle(
      "14:00",
      { intent: "FALLBACK", entities: { time: "14:00" }, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10, 11],
          date,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("SELECIONANDO_PROFISSIONAL");
    expect(result.contextUpdate.professionalOptionsData).toHaveLength(2);
    expect(result.reply).toContain("Ana");
    expect(result.reply).toContain("Bruno");
    expect(getAvailableSlots).toHaveBeenCalledWith(100, date, 30, 10);
    expect(getAvailableSlots).toHaveBeenCalledWith(101, date, 90, 11);
  });

  it('entende "duas e meia" como 14:30 quando esse é o horário disponível', async () => {
    const date = futureDate();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Iago Silva", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["14:30"]);

    const result = await new ColetandoHorarioState().handle(
      "duas e meia",
      {
        intent: "FALLBACK",
        entities: { time: "02:30" },
        confidence: 1,
      },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Montagem de Móveis",
          matchedServiceIds: [10],
          availableDayServiceIds: [10],
          date,
          timeZone: "America/Sao_Paulo",
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("SELECIONANDO_PROFISSIONAL");
    expect(result.contextUpdate.time).toBe("14:30");
    expect(result.contextUpdate.professionalOptionsData).toEqual([
      expect.objectContaining({
        professionalName: "Iago Silva",
        time: "14:30",
      }),
    ]);
    expect(result.reply).toContain("14:30");
    expect(result.reply).not.toContain("24/ago");
  });

  it("mantém 14:30 quando não há encaixe exato e prioriza alternativas reais da tarde", async () => {
    const date = futureDate();
    const actualSlots = [
      "08:00",
      "09:00",
      "11:00",
      "13:00",
      "14:00",
      "15:00",
      "16:30",
    ];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Iago Silva", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(actualSlots);

    const result = await new ColetandoHorarioState().handle(
      "duas e meia",
      {
        intent: "FALLBACK",
        entities: { time: "02:30" },
        confidence: 1,
      },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Montagem de Móveis",
          matchedServiceIds: [10],
          availableDayServiceIds: [10],
          date,
          timeZone: "America/Sao_Paulo",
        },
      } as BotChatSessionModel,
      1,
    );

    const suggestions = result.contextUpdate.suggestedSlots ?? [];
    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.reply).toContain("14:30");
    expect(result.reply).not.toContain("02:30");
    expect(suggestions.slice(0, 4)).toEqual([
      "14:00",
      "15:00",
      "13:00",
      "16:30",
    ]);
    expect(suggestions.every((slot) => actualSlots.includes(slot))).toBe(true);
  });

  it("consulta somente as ofertas disponíveis no dia escolhido", async () => {
    const date = futureDate();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(11, 101, "Bruno", 90),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["14:00"]);

    const result = await new ColetandoHorarioState().handle(
      "14:00",
      { intent: "FALLBACK", entities: { time: "14:00" }, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10, 11],
          availableDayServiceIds: [11],
          date,
        },
      } as BotChatSessionModel,
      1,
    );

    const query = (ServiceModel.findAll as jest.Mock).mock.calls[0][0];
    const idFilter = query.where.id;
    const inOperator = Object.getOwnPropertySymbols(idFilter)[0];
    expect(idFilter[inOperator]).toEqual([11]);
    expect(result.contextUpdate.professionalOptionsData).toHaveLength(1);
    expect(result.reply).toContain("Bruno");
    expect(getAvailableSlots).toHaveBeenCalledTimes(1);
    expect(getAvailableSlots).toHaveBeenCalledWith(101, date, 90, 11);
  });

  it("pede a escolha mesmo quando há somente um profissional disponível", async () => {
    const date = futureDate();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["14:00"]);

    const result = await new ColetandoHorarioState().handle(
      "14:00",
      { intent: "FALLBACK", entities: { time: "14:00" }, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10],
          date,
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("SELECIONANDO_PROFISSIONAL");
    expect(result.contextUpdate.professionalOptionsData).toHaveLength(1);
    expect(result.reply).toContain("Ana");
  });

  it("aceita trocar o dia enquanto aguardava um novo horário", async () => {
    const oldDate = futureDate(4);
    const date = futureDate(6);
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00"]);

    const result = await new ColetandoHorarioState().handle(
      date,
      { intent: "FALLBACK", entities: { date }, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10],
          date: oldDate,
          timeZone: "America/Sao_Paulo",
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.contextUpdate.date).toBe(date);
    expect(result.contextUpdate.availableDayServiceIds).toEqual([10]);
    expect(result.contextUpdate.availableDayProfessionals).toEqual([
      { professionalId: 100, professionalName: "Ana" },
    ]);
    expect(result.reply).toContain("Ana");
    expect(result.reply).toMatch(/qual horário/i);
    expect(ServiceModel.findAll).toHaveBeenCalledTimes(1);
    expect(getAvailableSlots).toHaveBeenCalledWith(100, date, 30, 10);
  });

  it("prioriza uma nova data quando a mensagem também contém horário", async () => {
    const oldDate = futureDate(4);
    const date = futureDate(6);
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["09:00", "14:00"]);

    const result = await new ColetandoHorarioState().handle(
      `dia ${date} às 14h`,
      {
        intent: "FALLBACK",
        entities: { date, time: "14:00" },
        confidence: 1,
      },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10],
          date: oldDate,
          timeZone: "America/Sao_Paulo",
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.contextUpdate.date).toBe(date);
    expect(result.contextUpdate.time).toBeUndefined();
    expect(result.reply).toContain("Ana");
    expect(result.reply).toMatch(/qual horário/i);
  });

  it("não interpreta 14:00 como a opção legada número 14", async () => {
    const date = futureDate();
    (ServiceModel.findAll as jest.Mock).mockResolvedValue([
      serviceFixture(10, 100, "Ana", 30),
    ]);
    (getAvailableSlots as jest.Mock).mockResolvedValue(["14:00"]);

    const result = await new ColetandoHorarioState().handle(
      "14:00",
      { intent: "FALLBACK", entities: { time: "14:00" }, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          matchedServiceIds: [10],
          date,
          suggestedSlotsData: [
            {
              index: 14,
              serviceId: 99,
              professionalId: 999,
              professionalName: "Opção antiga",
              price: 10000,
              duration: 30,
              time: "09:00",
            },
          ],
        },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("SELECIONANDO_PROFISSIONAL");
    expect(result.contextUpdate.professionalOptionsData).toEqual([
      expect.objectContaining({ professionalName: "Ana", time: "14:00" }),
    ]);
    expect(result.reply).not.toContain("Opção antiga");
  });

  it("continua aceitando a escolha numérica salva por sessões antigas", async () => {
    const date = futureDate();
    const result = await new ColetandoHorarioState().handle(
      "1",
      { intent: "FALLBACK", entities: {}, confidence: 1 },
      {
        context: {
          pendingAction: "CREATE",
          serviceName: "Limpeza residencial",
          date,
          suggestedSlots: ["1"],
          suggestedSlotsData: [
            {
              index: 1,
              serviceId: 10,
              professionalId: 100,
              professionalName: "Ana",
              price: 10000,
              duration: 30,
              time: "14:00",
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
      professionalName: "Ana",
      time: "14:00",
    });
    expect(result.reply).toContain("Ana");
    expect(ServiceModel.findAll).not.toHaveBeenCalled();
  });
});

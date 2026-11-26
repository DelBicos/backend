jest.mock("../../../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: { findByPk: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../../../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../../../models/Professional", () => ({ ProfessionalModel: {} }));
jest.mock("../../../../models/User", () => ({ UserModel: {} }));
import { ClientModel } from "../../../../models/Client";
import { AppointmentModel } from "../../../../models/Appointment";
import { AguardandoIdAgendamentoState } from "../AguardandoIdAgendamentoState";

it("recompõe o contexto, limpa escolhas antigas e mostra o dia de São Paulo na virada UTC", async () => {
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 3 });
  (AppointmentModel.findByPk as jest.Mock).mockResolvedValue({
    id: 8,
    client_id: 3,
    service_id: 2,
    professional_id: 1,
    status: "confirmed",
    payment_intent_id: "pi_paid",
    final_price: "120.00",
    start_time: new Date("2099-01-06T01:00Z"),
    end_time: new Date("2099-01-06T02:00Z"),
    Service: { title: "Limpeza", duration: 90 },
    Professional: { User: { name: "Ana" } },
  });
  const result = await new AguardandoIdAgendamentoState().handle(
    "8",
    { entities: {} } as any,
    {
      context: {
        pendingAction: "RESCHEDULE",
        matchedServiceIds: [999],
        newDate: "2099-02-02",
        newTime: "10:00",
      },
    } as any,
    10,
  );
  expect(result.contextUpdate).toMatchObject({
    appointmentId: 8,
    matchedServiceIds: [2],
    serviceName: "Limpeza",
    serviceDuration: 60,
    servicePrice: 12000,
    date: "2099-01-05",
    time: "22:00",
    appointmentPaid: true,
    newDate: undefined,
    newTime: undefined,
  });
  expect(result.reply).toContain("05/01/2099 às 22:00");
});

describe("AguardandoIdAgendamentoState - identificação do agendamento", () => {
  type HandleArgs = Parameters<AguardandoIdAgendamentoState["handle"]>;
  const run = (message: string, ctx: Record<string, unknown>, entities: Record<string, unknown> = {}) =>
    new AguardandoIdAgendamentoState().handle(
      message,
      { entities } as unknown as HandleArgs[1],
      { context: ctx } as unknown as HandleArgs[2],
      10,
    );
  const appointment = (overrides: Record<string, unknown> = {}) => ({
    id: 8,
    short_id: "AB12CD",
    client_id: 3,
    service_id: 2,
    professional_id: 1,
    status: "pending",
    payment_intent_id: null,
    final_price: null,
    start_time: new Date("2099-01-06T13:00Z"),
    end_time: new Date("2099-01-06T14:30Z"),
    Service: { title: "Pintura", price_cents: 9000 },
    Professional: { User: { name: "Bia" } },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 3 });
  });

  it("encerra quando o usuário não tem perfil de cliente", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    const result = await run("1", { pendingAction: "CANCEL" });
    expect(result).toMatchObject({ nextState: "FINALIZADO", finalize: true });
  });

  it("usa o índice da lista mostrada ao usuário", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment());
    const result = await run(" 2 ", {
      pendingAction: "CANCEL",
      userAppointmentList: [
        { index: 1, id: 5 },
        { index: 2, id: 8 },
      ],
    });
    expect((AppointmentModel.findByPk as jest.Mock).mock.calls[0][0]).toBe(8);
    expect(result.nextState).toBe("CONFIRMACAO");
    expect(result.reply).toContain("• ID: AB12CD");
    expect(result.reply).toContain("• Profissional: Bia");
    expect(result.contextUpdate).toMatchObject({
      appointmentId: 8,
      serviceId: 2,
      professionalId: 1,
      serviceOptions: ["Sim, confirmar", "Não, voltar"],
    });
  });

  it("usa o número como ID quando ele não está na lista", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment({ short_id: "" }));
    const result = await run("8", { pendingAction: "CANCEL", userAppointmentList: [{ index: 1, id: 5 }] });
    expect((AppointmentModel.findByPk as jest.Mock).mock.calls[0][0]).toBe(8);
    expect(result.reply).toContain("• ID: 8");
  });

  it("usa o ID reconhecido pelo classificador", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment());
    await run("o agendamento oito", { pendingAction: "CANCEL" }, { appointment_id: 8 });
    expect((AppointmentModel.findByPk as jest.Mock).mock.calls[0][0]).toBe(8);
  });

  it("procura pelo código curto quando não há número", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(appointment());
    await run("ab12cd", { pendingAction: "CANCEL" });
    expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
    expect((AppointmentModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { short_id: "AB12CD" },
    });
  });

  it.each([
    ["CANCEL", "cancelar"],
    ["RESCHEDULE", "reagendar"],
  ])("pede outro ID quando não encontra o agendamento (%s)", async (pendingAction, verb) => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);
    const result = await run("xyzw", { pendingAction });
    expect(result.nextState).toBe("AGUARDANDO_ID_AGENDAMENTO");
    expect(result.reply).toContain(`válido para ${verb}:`);
  });

  it("não busca por texto curto demais", async () => {
    const result = await run("ab", { pendingAction: "CANCEL" });
    expect(AppointmentModel.findOne).not.toHaveBeenCalled();
    expect(result.nextState).toBe("AGUARDANDO_ID_AGENDAMENTO");
  });

  it("não revela agendamento de outro cliente", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment({ client_id: 99 }));
    const result = await run("8", { pendingAction: "CANCEL" });
    expect(result.nextState).toBe("AGUARDANDO_ID_AGENDAMENTO");
  });

  it.each([
    ["completed", "já foi concluído"],
    ["canceled", "já está cancelado"],
  ])("não altera agendamento %s", async (status, text) => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment({ status }));
    const result = await run("8", { pendingAction: "CANCEL" });
    expect(result.nextState).toBe("INICIO");
    expect(result.reply).toContain(text);
  });

  it("usa o preço do serviço e nomes padrão ao remarcar sem preço final", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(
      appointment({ Service: { price: "75.5" }, Professional: null }),
    );
    const result = await run("8", { pendingAction: "RESCHEDULE" });
    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.contextUpdate).toMatchObject({
      serviceName: "Serviço",
      professionalName: "Profissional",
      servicePrice: 7550,
      serviceDuration: 90,
      appointmentPaid: false,
    });
  });

  it("usa price_cents do serviço e zero quando não há serviço", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValueOnce(appointment());
    const withCents = await run("8", { pendingAction: "RESCHEDULE" });
    expect(withCents.contextUpdate.servicePrice).toBe(9000);

    (AppointmentModel.findByPk as jest.Mock).mockResolvedValueOnce(appointment({ Service: null }));
    const withoutService = await run("8", { pendingAction: "RESCHEDULE" });
    expect(withoutService.contextUpdate.servicePrice).toBe(0);
  });
});

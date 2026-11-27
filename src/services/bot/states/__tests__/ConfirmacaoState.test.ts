jest.mock("../appointmentActions", () => ({
  createBotAppointment: jest.fn(),
  cancelBotAppointment: jest.fn(),
  rescheduleBotAppointment: jest.fn(),
}));
jest.mock("../../../../utils/logger", () => ({ logError: jest.fn() }));
import type { BotChatSessionModel, BotSessionContext } from "../../../../models/BotChatSession";
import type { NluResult } from "../../../nlu.service";
import { ConfirmacaoState } from "../ConfirmacaoState";
import {
  cancelBotAppointment,
  createBotAppointment,
  rescheduleBotAppointment,
} from "../appointmentActions";

const context = {
  pendingAction: "RESCHEDULE",
  appointmentId: 8,
  serviceName: "Limpeza",
  date: "2030-01-07",
  time: "09:00",
  newDate: "2030-01-08",
  newTime: "10:00",
};
beforeEach(() => jest.clearAllMocks());

it("remarca mantendo ID e pagamento, sem cancelar ou criar substituto", async () => {
  (rescheduleBotAppointment as jest.Mock).mockResolvedValue({
    id: 8,
    status: "pending",
    payment_intent_id: "pi_paid",
  });
  const result = await new ConfirmacaoState().handle(
    "sim",
    {} as any,
    { context } as any,
    1,
    "2030-01-08T13:00:00Z",
  );
  expect(cancelBotAppointment).not.toHaveBeenCalled();
  expect(createBotAppointment).not.toHaveBeenCalled();
  expect(rescheduleBotAppointment).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ date: "2030-01-08", time: "10:00" }),
    "2030-01-08T13:00:00Z",
  );
  expect(result.contextUpdate).toMatchObject({
    appointmentId: 8,
    appointmentPaid: true,
  });
  expect(result.reply).not.toContain("Novo agendamento");
});

describe("ConfirmacaoState - respostas e ações", () => {
  type HandleArgs = Parameters<ConfirmacaoState["handle"]>;
  const nlu = {} as unknown as HandleArgs[1];
  const run = (message: string, ctx: Record<string, unknown>, selectedTimeIso?: string) =>
    new ConfirmacaoState().handle(
      message,
      nlu,
      { context: ctx } as unknown as HandleArgs[2],
      1,
      selectedTimeIso,
    );

  it("pede sim ou não quando a resposta é ambígua", async () => {
    const result = await run("talvez amanhã", { pendingAction: "CREATE" });
    expect(result.nextState).toBe("CONFIRMACAO");
    expect(result.contextUpdate).toEqual({ serviceOptions: ["Sim", "Não"], serviceOptionsData: undefined });
  });

  it("descarta o cancelamento e encerra quando o usuário desiste", async () => {
    const result = await run("não", { pendingAction: "CANCEL", appointmentId: 8 });
    expect(result).toMatchObject({ nextState: "FINALIZADO", finalize: true });
    expect(result.reply).toContain("cancelamento foi descartado");
    expect(cancelBotAppointment).not.toHaveBeenCalled();
  });

  it("volta à escolha de data quando o usuário recusa o agendamento", async () => {
    const result = await run("voltar", { pendingAction: "CREATE" });
    expect(result).toMatchObject({ nextState: "COLETANDO_DATA", finalize: false });
    expect(result.contextUpdate).toEqual({ time: undefined, newTime: undefined });
  });

  it("cancela o agendamento confirmado", async () => {
    (cancelBotAppointment as jest.Mock).mockResolvedValue(undefined);
    const result = await run("sim", { pendingAction: "CANCEL", appointmentId: 8 });
    expect(cancelBotAppointment).toHaveBeenCalledWith(1, 8);
    expect(result).toMatchObject({
      reply: "✅ Agendamento ID 8 cancelado com sucesso.",
      nextState: "FINALIZADO",
      finalize: true,
    });
  });

  it("volta ao início quando falta o agendamento a cancelar", async () => {
    const result = await run("confirmo", { pendingAction: "CANCEL" });
    expect(result.nextState).toBe("INICIO");
    expect(result.reply).toBe("❌ ID do agendamento não encontrado na sessão");
  });

  it("volta à escolha de horário quando falta o agendamento a remarcar", async () => {
    const result = await run("sim", { pendingAction: "RESCHEDULE" });
    expect(result.nextState).toBe("COLETANDO_HORARIO");
    expect(result.reply).toBe("❌ ID do agendamento original não encontrado");
  });

  it("avisa que o pedido de reagendamento aguarda o profissional", async () => {
    (rescheduleBotAppointment as jest.Mock).mockResolvedValue({
      id: 8,
      reschedule_requested_start: new Date("2030-01-08T13:00:00Z"),
    });
    const result = await run("sim", { pendingAction: "RESCHEDULE", appointmentId: 8, date: "2030-01-08", time: "10:00" });
    expect(rescheduleBotAppointment).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ date: "2030-01-08", time: "10:00" }),
      undefined,
    );
    expect(result).toMatchObject({ nextState: "FINALIZADO", finalize: true, appointmentId: 8 });
    expect(result.reply).toContain("Pedido de reagendamento enviado");
  });

  it("pré-cria o agendamento quando não há ação pendente", async () => {
    (createBotAppointment as jest.Mock).mockResolvedValue({ id: 15 });
    const ctx = { serviceName: "Pintura", date: "2030-01-07", time: "10:00" };
    const result = await run("ok", ctx, "2030-01-07T13:00:00Z");
    expect(createBotAppointment).toHaveBeenCalledWith(1, ctx, "2030-01-07T13:00:00Z");
    expect(result).toMatchObject({
      nextState: "AGUARDANDO_CONFIRMACAO",
      appointmentId: 15,
      contextUpdate: { appointmentId: 15, appointmentStatus: "pending", appointmentPaid: false },
    });
    expect(result.reply).toContain("ID: 15");
  });

  it("usa mensagem genérica para erro sem texto", async () => {
    (createBotAppointment as jest.Mock).mockRejectedValue({});
    const result = await run("sim", { pendingAction: "CREATE", date: "2030-01-07", time: "10:00" });
    expect(result.reply).toBe("❌ Ocorreu um erro. Por favor, tente novamente.");
    expect(result.nextState).toBe("COLETANDO_HORARIO");
  });
});

it("permite nova escolha após falha sem cancelar a reserva", async () => {
  (rescheduleBotAppointment as jest.Mock).mockRejectedValue(
    new Error("Horário ocupado"),
  );
  const result = await new ConfirmacaoState().handle(
    "sim",
    {} as any,
    { context } as any,
    1,
  );
  expect(result.nextState).toBe("COLETANDO_HORARIO");
  expect(result.reply).toContain("Horário ocupado");
  expect(cancelBotAppointment).not.toHaveBeenCalled();
});

// Caso de teste T1 (DEL-186): agendar pelo chat com data válida termina em
// pré-criação, com pedido de pagamento e sem dizer que o profissional aceitou.
it("pré-cria o agendamento pelo chat e pede o pagamento sem afirmar o aceite", async () => {
  (createBotAppointment as jest.Mock).mockResolvedValue({ id: 42, status: "pending" });
  const createContext: BotSessionContext = {
    pendingAction: "CREATE",
    serviceName: "Limpeza",
    date: "2030-01-07",
    time: "09:00",
  };

  const result = await new ConfirmacaoState().handle(
    "sim",
    {} as NluResult,
    { context: createContext } as BotChatSessionModel,
    1,
    "2030-01-07T12:00:00Z",
  );

  expect(createBotAppointment).toHaveBeenCalledWith(1, createContext, "2030-01-07T12:00:00Z");
  expect(result.nextState).toBe("AGUARDANDO_CONFIRMACAO");
  expect(result.contextUpdate).toMatchObject({
    appointmentId: 42,
    appointmentStatus: "pending",
    appointmentPaid: false,
    serviceOptions: ["Pagar Agora"],
  });
  expect(result.reply).toContain("pré-criado");
  expect(result.reply).toContain("pagamento");
  expect(result.reply).toContain("aguardará o aceite do profissional");
  expect(result.reply).not.toMatch(/profissional (já )?aceitou/i);
});

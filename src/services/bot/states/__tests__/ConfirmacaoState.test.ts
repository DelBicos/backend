jest.mock("../appointmentActions", () => ({
  createBotAppointment: jest.fn(),
  cancelBotAppointment: jest.fn(),
  rescheduleBotAppointment: jest.fn(),
}));
jest.mock("../../../../utils/logger", () => ({ logError: jest.fn() }));
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

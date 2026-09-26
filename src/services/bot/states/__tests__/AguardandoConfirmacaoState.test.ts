jest.mock("../../../../models/Appointment", () => ({ AppointmentModel: { findOne: jest.fn() } }));
jest.mock("../../../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
import { AppointmentModel } from "../../../../models/Appointment";
import { ClientModel } from "../../../../models/Client";
import { AguardandoConfirmacaoState } from "../AguardandoConfirmacaoState";

it.each(["pi_paid", null])("preserva o pagamento real enquanto aguarda novo aceite: %s", async (payment) => {
  (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 3 });
  (AppointmentModel.findOne as jest.Mock).mockResolvedValue({ id: 8, status: "pending", payment_intent_id: payment });
  const result = await new AguardandoConfirmacaoState().handle(
    "status", {} as any, { context: { appointmentId: 8, appointmentPaid: !payment } } as any, 10,
  );
  expect(result.nextState).toBe("AGUARDANDO_CONFIRMACAO");
  expect(result.contextUpdate).toMatchObject({ appointmentPaid: Boolean(payment), appointmentStatus: "pending" });
  expect(AppointmentModel.findOne).toHaveBeenCalledWith({ where: { id: 8, client_id: 3 } });
});

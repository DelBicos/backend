jest.mock("../../../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: { findByPk: jest.fn() },
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

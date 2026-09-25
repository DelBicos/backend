import {
  AppointmentStatus,
  getAppointmentPaymentStatus,
  getAppointmentStatusMessage,
} from "../botAppointmentStatus.helpers";

const appointment = (
  status: AppointmentStatus,
  paymentIntentId: string | null = null,
) => ({
  status,
  payment_intent_id: paymentIntentId,
});

describe("botAppointmentStatus.service", () => {
  it("marca como pagamento pendente quando o profissional aceita antes do pagamento", () => {
    expect(getAppointmentPaymentStatus(appointment("confirmed"))).toBe(
      "pending",
    );
    expect(getAppointmentStatusMessage("confirmed", false)).toContain(
      "pagamento est\u00e1 pendente",
    );
  });

  it("marca como pago quando o PaymentIntent confirmado foi gravado", () => {
    expect(
      getAppointmentPaymentStatus(appointment("confirmed", "pi_test_123")),
    ).toBe("paid");
    expect(getAppointmentStatusMessage("confirmed", true)).toContain(
      "confirmado e pago",
    );
  });

  it.each(["pending", "canceled", "completed"] as const)(
    "n\u00e3o libera pagamento para agendamento %s",
    (status) => {
      expect(getAppointmentPaymentStatus(appointment(status))).toBe(
        "not_available",
      );
    },
  );
});

import {
  NotificationModel,
  original,
  rescheduleBotAppointment,
  rescheduleContext,
} from "./appointmentScheduleFixtures.service";

it("desfaz a remarcação no PostgreSQL se a notificação falhar e permite tentar novamente", async () => {
  const appointment = await original();
  const previousStart = appointment.start_time.getTime();
  const previousEnd = appointment.end_time.getTime();
  const previousStatus = appointment.status;
  (NotificationModel.bulkCreate as jest.Mock).mockRejectedValueOnce(new Error("Notificação indisponível"));

  await expect(rescheduleBotAppointment(10, rescheduleContext(appointment.id)))
    .rejects.toThrow("Notificação indisponível");
  await appointment.reload();
  expect(appointment.start_time.getTime()).toBe(previousStart);
  expect(appointment.end_time.getTime()).toBe(previousEnd);
  expect(appointment.status).toBe(previousStatus);
  expect(appointment.payment_intent_id).toBe("pi_paid");

  await expect(rescheduleBotAppointment(10, rescheduleContext(appointment.id)))
    .resolves.toMatchObject({ id: appointment.id, status: "pending" });
  expect(NotificationModel.bulkCreate).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ user_id: 20, related_entity_id: appointment.id })]),
    expect.objectContaining({ transaction: expect.any(Object) }),
  );
});

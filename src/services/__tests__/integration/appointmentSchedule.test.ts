import {
  sequelize, AppointmentModel, ClientModel, ProfessionalModel,
  ServiceModel, ProfessionalAvailabilityModel,
  ProfessionalAvailabilityLockModel, NotificationModel,
  createBotAppointment,
  rescheduleBotAppointment,
  resolveBotAppointmentStart,
  createAppointmentWithScheduleLock,
  withProfessionalScheduleLock,
  changePendingAppointmentStatus,
  expirePendingAppointment,
  getAvailableSlots,
  AppointmentRefundModel,
  processAppointmentRefunds,
  ensureAppointmentRefund,
  ensureChatRoomForAppointment,
  UserModel,
  syncBotSessionsForAppointmentStatus,
  paymentService,
  mockPaymentRetrieve,
  mockDirectRefund,
  date,
  context,
  reservation,
  original,
  rescheduleContext,
  expiredPaidReservation,
  paidIntent,
  unpaidReschedule,
  expectWaitingForScheduleLock
} from "./appointmentScheduleFixtures.service";
import type { CreationAttributes } from "sequelize";

it.each([undefined, `${date}T12:00:00.000Z`, `${date}T09:00:00-03:00`])(
  "grava o mesmo instante do contexto, independente do fuso informado: %s",
  async (iso) => {
    const result = await createBotAppointment(10, context, iso);
    expect(result.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  },
);

it.each([
  `${date}T13:00:00Z`,
  "2099-01-06T12:00:00Z",
  `${date}T09:00:00Z`,
  `${date}T09:00:00`,
  "inválido",
])("rejeita selected_time divergente/inválido sem gravar: %s", async (iso) => {
  await expect(createBotAppointment(10, context, iso)).rejects.toThrow(
    "não corresponde",
  );
  expect(await AppointmentModel.count()).toBe(0);
});

it("rejeita data passada e calendário inexistente", () => {
  expect(() => resolveBotAppointmentStart("2020-01-01", "09:00")).toThrow();
  expect(() => resolveBotAppointmentStart("2099-02-30", "09:00")).toThrow();
});

it("não permite usar um ISO livre para contornar um slot ocupado", async () => {
  await original();
  await expect(
    createBotAppointment(10, context, `${date}T13:00:00Z`),
  ).rejects.toThrow("não corresponde");
  await expect(
    createBotAppointment(10, context, `${date}T12:00:00Z`),
  ).rejects.toThrow("disponível");
  expect(await AppointmentModel.count()).toBe(1);
});

it("serializa duas criações simultâneas do bot em uma agenda vazia", async () => {
  const results = await Promise.allSettled([
    createBotAppointment(10, context),
    createBotAppointment(10, context),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(await AppointmentModel.count()).toBe(1);
});

it("serializa criação do bot contra criação convencional/pagamento com interseção parcial", async () => {
  const results = await Promise.allSettled([
    createBotAppointment(10, context),
    createAppointmentWithScheduleLock({
      ...reservation,
      payment_intent_id: null,
      start_time: new Date(`${date}T12:30Z`),
      end_time: new Date(`${date}T13:30Z`),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await AppointmentModel.count()).toBe(1);
});

it("remarca em interseção com o próprio horário sem mudar identidade, preço ou pagamento", async () => {
  const appt = await original();
  const result = await rescheduleBotAppointment(
    10,
    rescheduleContext(appt.id, "09:30"),
  );
  expect(result.id).toBe(appt.id);
  expect(result.start_time.toISOString()).toBe(`${date}T12:30:00.000Z`);
  expect(result.end_time.toISOString()).toBe(`${date}T13:30:00.000Z`);
  expect(result.payment_intent_id).toBe("pi_paid");
  expect(result.short_id).toBe("ABC123");
  expect(Number(result.final_price)).toBe(150);
  expect(result.status).toBe("pending");
  expect(await AppointmentModel.count()).toBe(1);
});

it("preserva a duração contratada mesmo após alteração do catálogo", async () => {
  const appt = await original();
  await ServiceModel.update({ duration: 90 }, { where: { id: 2 } });
  const result = await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(result.end_time.getTime() - result.start_time.getTime()).toBe(
    60 * 60000,
  );
});

it("mantém o original se o novo horário estiver ocupado e permite nova tentativa", async () => {
  const appt = await original();
  await AppointmentModel.create({
    ...reservation,
    payment_intent_id: null,
    start_time: new Date(`${date}T13:00Z`),
    end_time: new Date(`${date}T14:00Z`),
  });
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
  ).rejects.toThrow("disponível");
  await appt.reload();
  expect(appt.status).toBe("confirmed");
  expect(appt.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id, "11:00")),
  ).resolves.toMatchObject({ id: appt.id });
});

it("faz rollback real quando há falha depois do UPDATE e não notifica", async () => {
  const appt = await original();
  const save = AppointmentModel.prototype.save;
  jest
    .spyOn(AppointmentModel.prototype, "save")
    .mockImplementationOnce(async function (this: AppointmentModel, options) {
      await save.call(this, options);
      throw new Error("falha após update");
    });
  await expect(
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
  ).rejects.toThrow("falha após update");
  await appt.reload();
  expect(appt.start_time.toISOString()).toBe(`${date}T12:00:00.000Z`);
  expect(appt.status).toBe("confirmed");
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(NotificationModel.bulkCreate).not.toHaveBeenCalled();
});

it("repetir a confirmação mantém uma única reserva e não repete notificações", async () => {
  const appt = await original();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(await AppointmentModel.count()).toBe(1);
  expect(NotificationModel.bulkCreate).toHaveBeenCalledTimes(1);
});

it("protege remarcação contra criação concorrente no destino", async () => {
  const appt = await original();
  const results = await Promise.allSettled([
    rescheduleBotAppointment(10, rescheduleContext(appt.id)),
    createBotAppointment(10, { ...context, time: "10:00" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await AppointmentModel.count({
      where: { start_time: new Date(`${date}T13:00Z`) },
    }),
  ).toBe(1);
  expect((await AppointmentModel.findByPk(appt.id))?.status).not.toBe(
    "canceled",
  );
});

it("enxerga um bloqueio que foi confirmado antes de adquirir a agenda", async () => {
  let acquired!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = withProfessionalScheduleLock(1, async (transaction) => {
    await ProfessionalAvailabilityLockModel.create(
      {
        professional_id: 1,
        start_time: reservation.start_time,
        end_time: reservation.end_time,
      },
      { transaction },
    );
    acquired();
    await gate;
  });
  await ready;
  const booking = createBotAppointment(10, context);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const [rows] = await sequelize.query(
        "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%professional%'",
      );
      waiting = rows.length > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
  }
  await writer;
  await expect(booking).rejects.toThrow("disponível");
  expect(await AppointmentModel.count()).toBe(0);
});

it("aplica exclusão apenas ao ID original e mantém outras reservas bloqueando", async () => {
  const appt = await original();
  await AppointmentModel.create({
    ...reservation,
    payment_intent_id: null,
    start_time: new Date(`${date}T13:00Z`),
    end_time: new Date(`${date}T14:00Z`),
  });
  const slots = await getAvailableSlots(1, date, 60, 2, {
    excludeAppointmentId: appt.id,
  });
  expect(slots).toContain("09:00");
  expect(slots).not.toContain("09:30");
  expect(slots).not.toContain("10:00");
});

it("recusa remarcação de terceiro ou troca de serviço", async () => {
  const appt = await original();
  await expect(
    rescheduleBotAppointment(99, rescheduleContext(appt.id)),
  ).rejects.toThrow();
  await expect(
    rescheduleBotAppointment(10, {
      ...rescheduleContext(appt.id),
      serviceId: 999,
    }),
  ).rejects.toThrow("originais");
  await appt.reload();
  expect(appt.status).toBe("confirmed");
});

it("serializa confirmações repetidas do mesmo pagamento sem gerar conflito para estorno", async () => {
  const results = await Promise.all([
    createAppointmentWithScheduleLock(reservation),
    createAppointmentWithScheduleLock(reservation),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(await AppointmentModel.count()).toBe(1);
});

it("não aceita a data antiga quando o profissional confirma durante uma remarcação", async () => {
  const appt = await AppointmentModel.create({
    ...reservation,
    status: "pending",
  });
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await expect(
    changePendingAppointmentStatus(appt, "confirmed"),
  ).rejects.toThrow("alterado");
  await appt.reload();
  expect(appt.status).toBe("pending");
});

it("renova o prazo de aceite da reserva remarcada e revalida candidatos antigos do job", async () => {
  const appt = await original();
  const oldTimestamp = new Date(Date.now() - 24 * 3600000);
  await sequelize.query(
    "UPDATE appointment SET created_at = :old, updated_at = :old WHERE id = :id",
    { replacements: { old: oldTimestamp, id: appt.id } },
  );
  await appt.reload();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  expect(
    await expirePendingAppointment(appt, new Date(Date.now() - 12 * 3600000)),
  ).toBe(false);
  await appt.reload();
  expect(appt.status).toBe("pending");
  expect(appt.createdAt.getTime()).toBe(oldTimestamp.getTime());
  expect(appt.payment_intent_id).toBe("pi_paid");
});

it("expira somente uma reserva que continua pendente e sem atualização por 12 horas", async () => {
  const appt = await AppointmentModel.create({
    ...reservation,
    status: "pending",
  });
  const oldTimestamp = new Date(Date.now() - 24 * 3600000);
  await sequelize.query(
    "UPDATE appointment SET updated_at = :old WHERE id = :id",
    { replacements: { old: oldTimestamp, id: appt.id } },
  );
  expect(
    await expirePendingAppointment(appt, new Date(Date.now() - 12 * 3600000)),
  ).toBe(true);
  await appt.reload();
  expect(appt.status).toBe("canceled");
  expect(await AppointmentRefundModel.count()).toBe(1);
});

it("cancela a remarcação expirada e registra exatamente um estorno, mesmo com dois jobs", async () => {
  const appt = await expiredPaidReservation();
  const deadline = new Date(Date.now() - 12 * 3600000);
  const outcomes = await Promise.all([
    expirePendingAppointment(appt, deadline), expirePendingAppointment(appt, deadline),
  ]);
  expect(outcomes.sort()).toEqual([false, true]);
  const refunds = await AppointmentRefundModel.findAll();
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({ appointment_id: appt.id, payment_intent_id: "pi_paid", status: "pending" });
  await appt.reload();
  expect(appt.status).toBe("canceled");
  expect(appt.payment_intent_id).toBe("pi_paid");
});

it("desfaz cancelamento e outbox juntos se a transação falhar após registrar o estorno", async () => {
  const appt = await expiredPaidReservation();
  const real = AppointmentRefundModel.findOrCreate.bind(AppointmentRefundModel);
  jest.spyOn(AppointmentRefundModel, "findOrCreate").mockImplementationOnce(async (options) => {
    await real(options);
    throw new Error("falha antes do commit");
  });
  await expect(expirePendingAppointment(appt, new Date())).rejects.toThrow("falha antes do commit");
  await appt.reload();
  expect(appt.status).toBe("pending");
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(await AppointmentRefundModel.count()).toBe(0);
  expect(ensureAppointmentRefund).not.toHaveBeenCalled();
});

it("retoma estorno persistido após falha do provedor sem precisar de nova expiração", async () => {
  const appt = await expiredPaidReservation();
  await expirePendingAppointment(appt, new Date());
  (ensureAppointmentRefund as jest.Mock).mockRejectedValueOnce(new Error("Stripe indisponível"));
  await processAppointmentRefunds();
  const job = (await AppointmentRefundModel.findOne())!;
  expect(job).toMatchObject({ status: "pending", attempts: 1, last_error: "Stripe indisponível" });
  await job.update({ next_attempt_at: new Date(0) });
  await processAppointmentRefunds();
  await job.reload();
  expect(job).toMatchObject({ status: "completed", attempts: 2, last_error: null });
});

it("serializa dois workers e não reenvia um item concluído", async () => {
  const appt = await expiredPaidReservation();
  await expirePendingAppointment(appt, new Date());
  await Promise.all([processAppointmentRefunds(), processAppointmentRefunds()]);
  await processAppointmentRefunds();
  expect(ensureAppointmentRefund).toHaveBeenCalledTimes(1);
  expect((await AppointmentRefundModel.findOne())?.status).toBe("completed");
});

it("conserva o item para reconciliação quando o provedor respondeu mas o save falhou", async () => {
  const appt = await expiredPaidReservation();
  await expirePendingAppointment(appt, new Date());
  jest.spyOn(AppointmentRefundModel.prototype, "save").mockRejectedValueOnce(new Error("commit indisponível"));
  await processAppointmentRefunds();
  expect((await AppointmentRefundModel.findOne())?.status).toBe("pending");
  await processAppointmentRefunds();
  expect((await AppointmentRefundModel.findOne())?.status).toBe("completed");
  expect(ensureAppointmentRefund).toHaveBeenNthCalledWith(1, "pi_paid");
  expect(ensureAppointmentRefund).toHaveBeenNthCalledWith(2, "pi_paid");
});

it("mantém na fila o estorno ainda pendente no provedor", async () => {
  const appt = await expiredPaidReservation();
  await expirePendingAppointment(appt, new Date());
  (ensureAppointmentRefund as jest.Mock).mockResolvedValueOnce(false);
  await processAppointmentRefunds();
  expect((await AppointmentRefundModel.findOne())?.status).toBe("pending");
  await processAppointmentRefunds();
  expect(ensureAppointmentRefund).toHaveBeenCalledTimes(1);
});

it("rejeição do profissional também registra estorno na transação", async () => {
  const appt = await expiredPaidReservation();
  await appt.reload();
  await changePendingAppointmentStatus(appt, "canceled");
  expect(await AppointmentRefundModel.count()).toBe(1);
  expect(appt.status).toBe("canceled");
});

it("expiração sem pagamento não gera estorno", async () => {
  const appt = await expiredPaidReservation();
  await appt.update({ payment_intent_id: null });
  await expirePendingAppointment(appt, new Date(Date.now() + 1000));
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it.each(["notificação", "sincronização"])("falha de %s após pagamento não gera estorno nem erro ao cliente", async (effect) => {
  const appt = await unpaidReschedule();
  const mock = effect === "notificação" ? NotificationModel.create : syncBotSessionsForAppointmentStatus;
  (mock as jest.Mock).mockRejectedValueOnce(new Error("efeito indisponível"));
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).resolves.toMatchObject({ id: appt.id });
  await appt.reload();
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(appt.status).toBe("pending");
  expect(mockDirectRefund).not.toHaveBeenCalled();
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it("falha de chat após criação paga não desfaz a reserva nem estorna", async () => {
  paidIntent();
  (ensureChatRoomForAppointment as jest.Mock).mockRejectedValueOnce(new Error("chat indisponível"));
  const appt = await paymentService.confirmAndCreateAppointment("pi_paid", 10);
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(await AppointmentModel.count()).toBe(1);
  expect(await AppointmentRefundModel.count()).toBe(0);
  expect(mockDirectRefund).not.toHaveBeenCalled();
});

it.each([true, false])("confirmação repetida ignora catálogo alterado e não renova prazo (com appointmentId: %s)", async (withId) => {
  const appt = await original();
  await rescheduleBotAppointment(10, rescheduleContext(appt.id));
  await appt.reload();
  const updatedAt = appt.updatedAt.getTime();
  paidIntent(withId ? appt.id : undefined);
  await ServiceModel.update({ price_cents: 20000, active: false }, { where: { id: 2 } });
  const result = await paymentService.confirmAndCreateAppointment("pi_paid", 10);
  expect(result.id).toBe(appt.id);
  await appt.reload();
  expect(appt.updatedAt.getTime()).toBe(updatedAt);
  expect(Number(appt.final_price)).toBe(150);
  expect(mockDirectRefund).not.toHaveBeenCalled();
  expect(NotificationModel.create).not.toHaveBeenCalled();
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it("primeiro pagamento usa o preço contratado da reserva remarcada", async () => {
  const appt = await unpaidReschedule();
  await ServiceModel.update({ price_cents: 20000 }, { where: { id: 2 } });
  await paymentService.confirmAndCreateAppointment("pi_paid", 10);
  await appt.reload();
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(Number(appt.final_price)).toBe(150);
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it("duas confirmações simultâneas do mesmo pagamento produzem um vínculo e uma notificação", async () => {
  const appt = await unpaidReschedule();
  const results = await Promise.all([
    paymentService.confirmAndCreateAppointment("pi_paid", 10),
    paymentService.confirmAndCreateAppointment("pi_paid", 10),
  ]);
  expect(results.map((result) => result.id)).toEqual([appt.id, appt.id]);
  expect(NotificationModel.create).toHaveBeenCalledTimes(1);
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it("pagamento após expiração gera compensação persistida sem vincular o pagamento à reserva cancelada", async () => {
  const appt = await unpaidReschedule();
  await expirePendingAppointment(appt, new Date(Date.now() + 1000));
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "APPOINTMENT_NOT_PAYABLE" });
  await appt.reload();
  expect(appt.status).toBe("canceled");
  expect(appt.payment_intent_id).toBeNull();
  expect(await AppointmentRefundModel.count()).toBe(1);
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "PAYMENT_REFUND_PENDING" });
  expect(await AppointmentRefundModel.count()).toBe(1);
  await processAppointmentRefunds();
  expect(ensureAppointmentRefund).toHaveBeenCalledWith("pi_paid");
});

it("pagamento que obtém a trava primeiro renova o prazo e impede expiração concorrente", async () => {
  const appt = await unpaidReschedule();
  await sequelize.query("UPDATE appointment SET updated_at = :old WHERE id = :id", {
    replacements: { old: new Date(Date.now() - 24 * 3600000), id: appt.id },
  });
  let expiry: Promise<boolean> | undefined;
  AppointmentModel.addHook("beforeUpdate", "payment-first", async (instance: AppointmentModel) => {
    if (instance.changed("payment_intent_id")) {
      expiry = expirePendingAppointment(appt, new Date(Date.now() - 12 * 3600000));
      await expectWaitingForScheduleLock();
    }
  });
  try {
    await paymentService.confirmAndCreateAppointment("pi_paid", 10);
    expect(expiry).toBeDefined();
    expect(await expiry).toBe(false);
  } finally { AppointmentModel.removeHook("beforeUpdate", "payment-first"); }
  await appt.reload();
  expect(appt.status).toBe("pending");
  expect(appt.payment_intent_id).toBe("pi_paid");
  expect(await AppointmentRefundModel.count()).toBe(0);
});

it("expiração que obtém a trava primeiro força compensação do pagamento concorrente", async () => {
  const appt = await unpaidReschedule();
  let confirmation: Promise<unknown> | undefined;
  AppointmentModel.addHook("beforeUpdate", "expiry-first", async (instance: AppointmentModel) => {
    if (instance.status === "canceled") {
      confirmation = paymentService.confirmAndCreateAppointment("pi_paid", 10).catch((error) => error);
      await expectWaitingForScheduleLock();
    }
  });
  try {
    await expirePendingAppointment(appt, new Date(Date.now() + 1000));
    expect(confirmation).toBeDefined();
    expect(await confirmation).toMatchObject({ code: "APPOINTMENT_NOT_PAYABLE" });
  } finally { AppointmentModel.removeHook("beforeUpdate", "expiry-first"); }
  await appt.reload();
  expect(appt.payment_intent_id).toBeNull();
  expect(appt.status).toBe("canceled");
  expect(await AppointmentRefundModel.count()).toBe(1);
});

it("erro de persistência faz rollback e permite repetir, sem estorno às cegas", async () => {
  const appt = await unpaidReschedule();
  const realSave = AppointmentModel.prototype.save;
  jest.spyOn(AppointmentModel.prototype, "save").mockImplementationOnce(async function (this: AppointmentModel, options?: Parameters<AppointmentModel["save"]>[0]) {
    await realSave.call(this, options);
    throw new Error("falha depois do UPDATE");
  });
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toThrow("falha depois do UPDATE");
  await appt.reload();
  expect(appt.payment_intent_id).toBeNull();
  expect(mockDirectRefund).not.toHaveBeenCalled();
  expect(await AppointmentRefundModel.count()).toBe(0);
  await paymentService.confirmAndCreateAppointment("pi_paid", 10);
  await appt.reload();
  expect(appt.payment_intent_id).toBe("pi_paid");
});

it("valor incorreto sem reserva registra estorno durável e impede criação numa repetição", async () => {
  paidIntent(undefined, 10000);
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  expect((await AppointmentRefundModel.findOne())?.appointment_id).toBeNull();
  expect(await AppointmentModel.count()).toBe(0);
  await ServiceModel.update({ price_cents: 10000 }, { where: { id: 2 } });
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "PAYMENT_REFUND_PENDING" });
  expect(await AppointmentModel.count()).toBe(0);
});

it("cliente diferente não pode reembolsar nem assumir o pagamento de outra reserva", async () => {
  const appt = await original();
  paidIntent(appt.id);
  await ClientModel.create({ id: 9, user_id: 99 } as CreationAttributes<ClientModel>);
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 99)).rejects.toMatchObject({ code: "PAYMENT_NOT_OWNED" });
  expect(await AppointmentRefundModel.count()).toBe(0);
  expect(mockDirectRefund).not.toHaveBeenCalled();
});

it("pagamentos diferentes simultâneos preservam o primeiro e compensam apenas o excedente", async () => {
  const appt = await unpaidReschedule();
  const intent = await mockPaymentRetrieve();
  mockPaymentRetrieve.mockImplementation(async (id: string) => ({ ...intent, id }));
  const results = await Promise.allSettled([
    paymentService.confirmAndCreateAppointment("pi_one", 10),
    paymentService.confirmAndCreateAppointment("pi_two", 10),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  await appt.reload();
  const refund = (await AppointmentRefundModel.findOne())!;
  expect(["pi_one", "pi_two"]).toContain(appt.payment_intent_id);
  expect(["pi_one", "pi_two"]).toContain(refund.payment_intent_id);
  expect(refund.payment_intent_id).not.toBe(appt.payment_intent_id);
  expect(await AppointmentRefundModel.count()).toBe(1);
});

it("nova criação paga com slot ocupado registra compensação sem criar reserva", async () => {
  await AppointmentModel.create({ ...reservation, payment_intent_id: null });
  paidIntent();
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  expect(await AppointmentModel.count()).toBe(1);
  expect((await AppointmentRefundModel.findOne())?.appointment_id).toBeNull();
});

it("falha ao gravar compensação não produz efeito no Stripe e pode ser retentada", async () => {
  const appt = await unpaidReschedule();
  await expirePendingAppointment(appt, new Date(Date.now() + 1000));
  jest.spyOn(AppointmentRefundModel, "findOrCreate").mockRejectedValueOnce(new Error("outbox indisponível"));
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toThrow("outbox indisponível");
  expect(await AppointmentRefundModel.count()).toBe(0);
  expect(mockDirectRefund).not.toHaveBeenCalled();
  await expect(paymentService.confirmAndCreateAppointment("pi_paid", 10)).rejects.toMatchObject({ code: "APPOINTMENT_NOT_PAYABLE" });
  expect(await AppointmentRefundModel.count()).toBe(1);
});

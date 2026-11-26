jest.mock("../../config/database");
jest.mock("../../models/Appointment");
jest.mock("../../models/AppointmentRefund");
jest.mock("../appointmentRefundProvider.service", () => ({
  ensureAppointmentRefund: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { Transaction } from "sequelize";
import { sequelize } from "../../config/database";
import { AppointmentModel } from "../../models/Appointment";
import { AppointmentRefundModel } from "../../models/AppointmentRefund";
import logger from "../../utils/logger";
import { ensureAppointmentRefund } from "../appointmentRefundProvider.service";
import {
  enqueueAppointmentRefund,
  enqueuePaymentRefund,
  processAppointmentRefunds,
  settleQueuedPayment,
} from "../appointmentRefund.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const tx = { LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction;
const NOW = new Date("2030-01-10T12:00:00.000Z");
const transactionSpy = jest.spyOn(sequelize, "transaction");

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  status: "pending",
  attempts: 0,
  payment_intent_id: "pi_1",
  next_attempt_at: new Date(NOW.getTime() - 1000),
  last_error: "anterior" as string | null,
  save: jest.fn(),
  ...overrides,
});

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  transactionSpy.mockImplementation((async (work: (t: Transaction) => Promise<unknown>) =>
    work(tx)) as unknown as typeof sequelize.transaction);
});

describe("enqueueAppointmentRefund", () => {
  it("ignora agendamento sem pagamento", async () => {
    await enqueueAppointmentRefund({ id: 1, payment_intent_id: null } as unknown as AppointmentModel, tx);
    expect(AppointmentRefundModel.findOrCreate).not.toHaveBeenCalled();
  });

  it("enfileira o pagamento do agendamento na mesma transacao", async () => {
    await enqueueAppointmentRefund({ id: 1, payment_intent_id: "pi_1" } as unknown as AppointmentModel, tx);
    expect(AppointmentRefundModel.findOrCreate).toHaveBeenCalledWith({
      where: { payment_intent_id: "pi_1" },
      defaults: { appointment_id: 1, payment_intent_id: "pi_1" },
      transaction: tx,
    });
  });
});

describe("enqueuePaymentRefund", () => {
  it("enfileira pagamento sem agendamento vinculado", async () => {
    await enqueuePaymentRefund("pi_9", null);
    expect(AppointmentRefundModel.findOrCreate).toHaveBeenCalledWith({
      where: { payment_intent_id: "pi_9" },
      defaults: { appointment_id: null, payment_intent_id: "pi_9" },
      transaction: undefined,
    });
  });
});

describe("settleQueuedPayment", () => {
  it("devolve false quando o pagamento nao esta na fila", async () => {
    mocked(AppointmentRefundModel.findOne).mockResolvedValue(null);
    await expect(settleQueuedPayment("pi_1")).resolves.toBe(false);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("processa na hora mesmo antes da proxima tentativa e conclui o item", async () => {
    const job = makeJob({ next_attempt_at: new Date(NOW.getTime() + 60_000) });
    mocked(AppointmentRefundModel.findOne).mockResolvedValue({ id: 7 });
    mocked(AppointmentRefundModel.findByPk).mockResolvedValue(job);
    mocked(ensureAppointmentRefund).mockResolvedValue(true);

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(true);

    expect(AppointmentRefundModel.findByPk).toHaveBeenCalledWith(7, { transaction: tx, lock: "UPDATE" });
    expect(ensureAppointmentRefund).toHaveBeenCalledWith("pi_1");
    expect(job).toMatchObject({ status: "completed", attempts: 1, last_error: null });
    expect(job.next_attempt_at).toEqual(new Date(NOW.getTime() + 10 * 60 * 1000));
    expect(job.save).toHaveBeenCalledWith({ transaction: tx });
  });

  it("mantem pendente quando o provedor ainda nao concluiu", async () => {
    const job = makeJob();
    mocked(AppointmentRefundModel.findOne).mockResolvedValue({ id: 7 });
    mocked(AppointmentRefundModel.findByPk).mockResolvedValue(job);
    mocked(ensureAppointmentRefund).mockResolvedValue(false);

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(false);
    expect(job.status).toBe("pending");
  });

  it("registra o erro do provedor e reagenda a tentativa", async () => {
    const job = makeJob();
    mocked(AppointmentRefundModel.findOne).mockResolvedValue({ id: 7 });
    mocked(AppointmentRefundModel.findByPk).mockResolvedValue(job);
    mocked(ensureAppointmentRefund).mockRejectedValue(new Error("stripe fora"));

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(false);

    expect(job).toMatchObject({ status: "pending", attempts: 1, last_error: "stripe fora" });
    expect(job.save).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Falha na devolução de pagamento; será retentada",
      { refundId: 7, error: "stripe fora" },
    );
  });

  it("nao reprocessa item ja concluido e o trata como devolvido", async () => {
    mocked(AppointmentRefundModel.findOne).mockResolvedValue({ id: 7 });
    mocked(AppointmentRefundModel.findByPk).mockResolvedValue(makeJob({ status: "completed" }));

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(true);
    expect(ensureAppointmentRefund).not.toHaveBeenCalled();
  });

  it("devolve false quando o item sumiu da fila", async () => {
    mocked(AppointmentRefundModel.findOne).mockResolvedValue({ id: 7 });
    mocked(AppointmentRefundModel.findByPk).mockResolvedValue(null);

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(false);
  });

  it("registra e devolve false quando a consulta falha", async () => {
    mocked(AppointmentRefundModel.findOne).mockRejectedValue(new Error("db fora"));

    await expect(settleQueuedPayment("pi_1")).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith("Falha ao processar devolução imediata", {
      paymentIntentId: "pi_1",
      error: "db fora",
    });
  });
});

describe("processAppointmentRefunds", () => {
  it("processa os itens vencidos em ordem e respeita a proxima tentativa", async () => {
    const due = makeJob({ id: 1 });
    const notYet = makeJob({ id: 2, next_attempt_at: new Date(NOW.getTime() + 60_000) });
    mocked(AppointmentRefundModel.findAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mocked(AppointmentRefundModel.findByPk).mockImplementation(async (id: number) =>
      id === 1 ? due : notYet,
    );
    mocked(ensureAppointmentRefund).mockResolvedValue(true);

    await processAppointmentRefunds();

    expect(AppointmentRefundModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, order: [["next_attempt_at", "ASC"], ["id", "ASC"]] }),
    );
    expect(ensureAppointmentRefund).toHaveBeenCalledTimes(1);
    expect(due.status).toBe("completed");
    expect(notYet.save).not.toHaveBeenCalled();
  });

  it("segue para o proximo item quando a transacao de um deles falha", async () => {
    mocked(AppointmentRefundModel.findAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const second = makeJob({ id: 2 });
    mocked(AppointmentRefundModel.findByPk)
      .mockRejectedValueOnce(new Error("commit falhou"))
      .mockResolvedValueOnce(second);
    mocked(ensureAppointmentRefund).mockResolvedValue(true);

    await processAppointmentRefunds();

    expect(logger.error).toHaveBeenCalledWith("Falha ao processar item de devolução", {
      refundId: 1,
      error: "commit falhou",
    });
    expect(second.status).toBe("completed");
  });
});

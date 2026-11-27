jest.mock("../../../config/database");
jest.mock("../../../models/Notification");
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { NotificationModel } from "../../../models/Notification";
import logger from "../../../utils/logger";
import * as notifications from "../appointmentNotifications.service";

const create = NotificationModel.create as jest.Mock;
// 15:30 em Sao Paulo (UTC-3).
const START = new Date("2030-01-10T18:30:00.000Z");

const sent = () =>
  create.mock.calls.map(([payload]) => payload as Record<string, unknown>);
const messages = () => sent().map((p) => p.message as string);

beforeEach(() => create.mockResolvedValue({}));

describe("formatacao de data e hora", () => {
  it("formata no fuso de Sao Paulo", () => {
    expect(notifications.formatAppointmentDate(START)).toBe("10/01/2030");
    expect(notifications.formatAppointmentTime(START)).toBe("15:30");
  });
});

describe("notify (via notificacoes publicas)", () => {
  it("nao cria notificacao sem destinatario", async () => {
    await notifications.notifyAppointmentAccepted(undefined, "Corte", 1);
    expect(create).not.toHaveBeenCalled();
  });

  it("registra a falha e nao propaga o erro", async () => {
    create.mockRejectedValue(new Error("db fora"));

    await expect(notifications.notifyAppointmentAccepted(7, "Corte", 1)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith("Falha ao criar notificação de agendamento", {
      appointmentId: 1,
      userId: 7,
      reason: "db fora",
    });
  });
});

describe("notifyAppointmentCreated", () => {
  it("avisa profissional e cliente com data e hora", async () => {
    await notifications.notifyAppointmentCreated({
      appointmentId: 3,
      startTime: START,
      serviceTitle: "Corte",
      clientUserId: 1,
      clientName: "Ana",
      professionalUserId: 2,
    });

    expect(sent()).toEqual([
      expect.objectContaining({
        user_id: 2,
        title: "Novo Agendamento Recebido",
        notification_type: "appointment",
        related_entity_id: 3,
        is_read: false,
      }),
      expect.objectContaining({ user_id: 1, title: "Agendamento Criado com Sucesso" }),
    ]);
    expect(messages()[0]).toContain("de Ana para o serviço 'Corte' no dia 10/01/2030 às 15:30");
    expect(messages()[1]).toContain("no dia 10/01/2030 às 15:30 foi criado");
  });

  it("usa nome padrao quando o cliente nao tem nome e pula quem nao tem usuario", async () => {
    await notifications.notifyAppointmentCreated({
      appointmentId: 3,
      startTime: START,
      serviceTitle: "Corte",
      clientUserId: null,
      professionalUserId: 2,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain("de Cliente Desconhecido");
  });
});

describe("notifyAppointmentAccepted e notifyAppointmentCompleted", () => {
  it("avisa o cliente do aceite", async () => {
    await notifications.notifyAppointmentAccepted(1, "Corte", 3);
    expect(sent()[0]).toMatchObject({ user_id: 1, title: "Seu agendamento foi aceito!" });
    expect(messages()[0]).toContain("'Corte'");
  });

  it("avisa o cliente da conclusao", async () => {
    await notifications.notifyAppointmentCompleted(1, "Corte", 3);
    expect(sent()[0]).toMatchObject({ user_id: 1, title: "Atendimento concluído" });
  });
});

describe("notifyAppointmentRejected", () => {
  it.each([
    ["released", "A reserva no seu cartão foi liberada"],
    ["refunded", "O valor do pagamento foi estornado com sucesso."],
    ["processing", "O estorno do pagamento está sendo processado."],
  ] as const)("descreve o estorno %s", async (refund, text) => {
    await notifications.notifyAppointmentRejected(1, "Corte", 3, refund);
    expect(messages()[0]).toContain(text);
  });

  it("nao fala de estorno quando nao houve pagamento", async () => {
    await notifications.notifyAppointmentRejected(1, "Corte", 3, "none");
    expect(messages()[0]).toBe("O profissional não pôde aceitar o serviço 'Corte'.");
  });
});

describe("notifyReviewReceived", () => {
  it("inclui servico e comentario e usa o tipo service", async () => {
    await notifications.notifyReviewReceived(2, 3, 5, "Otimo", "Corte");

    expect(sent()[0]).toMatchObject({ user_id: 2, notification_type: "service" });
    expect(messages()[0]).toBe(
      "Você recebeu uma avaliação de 5 estrelas para o serviço 'Corte': \"Otimo\"",
    );
  });

  it("omite servico e comentario ausentes", async () => {
    await notifications.notifyReviewReceived(2, 3, 4, null);
    expect(messages()[0]).toBe("Você recebeu uma avaliação de 4 estrelas.");
  });
});

describe("notifyPaymentConfirmed", () => {
  it("avisa o cliente com data e hora", async () => {
    await notifications.notifyPaymentConfirmed(1, 3, "Corte", START);
    expect(sent()[0]).toMatchObject({ user_id: 1, title: "Pagamento Confirmado" });
    expect(messages()[0]).toContain("no dia 10/01/2030 às 15:30 foi confirmado!");
  });
});

describe("notifyAppointmentCanceled", () => {
  const base = { recipientUserId: 1, serviceTitle: "Corte", appointmentId: 3 };

  it("descreve retencao parcial quando o cliente cancela", async () => {
    await notifications.notifyAppointmentCanceled({
      ...base,
      canceledBy: "client",
      refundedCents: 5000,
      retainedCents: 1000,
    });
    const message = messages()[0];
    expect(message).toMatch(/^O cliente cancelou o serviço 'Corte'\. Foram retidos/);
    expect(message).toMatch(/R\$\s10,00/);
    expect(message).toMatch(/R\$\s50,00 devolvidos\.$/);
  });

  it("descreve devolucao integral quando o profissional cancela", async () => {
    await notifications.notifyAppointmentCanceled({
      ...base,
      canceledBy: "professional",
      refundedCents: 5000,
      retainedCents: 0,
    });
    expect(messages()[0]).toMatch(
      /^O profissional cancelou o serviço 'Corte'\. O valor de R\$\s50,00 foi devolvido integralmente\.$/,
    );
  });

  it("nao fala de valores quando o sistema cancela sem pagamento", async () => {
    await notifications.notifyAppointmentCanceled({
      ...base,
      canceledBy: "system",
      refundedCents: 0,
      retainedCents: 0,
    });
    expect(messages()[0]).toBe("O sistema cancelou o serviço 'Corte'.");
  });
});

describe("notifyNoShow", () => {
  it("avisa o cliente e cita o prazo de disputa", async () => {
    await notifications.notifyNoShow(1, "Corte", 3);
    expect(sent()[0]).toMatchObject({ title: "Não comparecimento registrado" });
    expect(messages()[0]).toContain("abra uma disputa em até 7 dias");
  });
});

describe("reagendamento", () => {
  it("avisa o pedido com a nova data", async () => {
    await notifications.notifyRescheduleRequested(2, "Corte", 3, START);
    expect(sent()[0]).toMatchObject({ user_id: 2, title: "Pedido de reagendamento" });
    expect(messages()[0]).toContain("para 10/01/2030 às 15:30");
  });

  it("avisa que o reagendamento foi aceito", async () => {
    await notifications.notifyRescheduleAnswered(1, "Corte", 3, true);
    expect(sent()[0]).toMatchObject({ title: "Reagendamento aceito" });
    expect(messages()[0]).toBe("O novo horário de 'Corte' foi confirmado.");
  });

  it("avisa que o reagendamento foi recusado", async () => {
    await notifications.notifyRescheduleAnswered(1, "Corte", 3, false);
    expect(sent()[0]).toMatchObject({ title: "Reagendamento recusado" });
    expect(messages()[0]).toContain("O horário original continua valendo.");
  });
});

describe("disputas", () => {
  it("avisa o profissional da disputa aberta", async () => {
    await notifications.notifyDisputeOpened(2, "Corte", 3);
    expect(sent()[0]).toMatchObject({ user_id: 2, title: "Disputa aberta" });
  });

  it("avisa cada parte do estorno da disputa e pula quem nao tem usuario", async () => {
    await notifications.notifyDisputeResolved({
      userIds: [1, undefined, 2],
      serviceTitle: "Corte",
      appointmentId: 3,
      resolution: "refund_partial",
      refundCents: 2500,
    });

    expect(sent().map((p) => p.user_id)).toEqual([1, 2]);
    expect(messages()[0]).toMatch(
      /^Serviço 'Corte': A disputa foi analisada e R\$\s25,00 foram devolvidos ao cliente\.$/,
    );
  });

  it("informa quando a disputa foi rejeitada", async () => {
    await notifications.notifyDisputeResolved({
      userIds: [1],
      serviceTitle: "Corte",
      appointmentId: 3,
      resolution: "rejected",
      refundCents: 0,
    });
    expect(messages()[0]).toBe(
      "Serviço 'Corte': A disputa foi analisada e não houve alteração no valor.",
    );
  });
});

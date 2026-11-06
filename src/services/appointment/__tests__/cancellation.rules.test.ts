import { HttpError } from "../../../errors/HttpError";
import {
  assertCanCancel,
  assertCanDispute,
  assertCanMarkNoShow,
  assertCanReschedule,
  computeCancellationOutcome,
  retentionFor,
} from "../cancellation.rules";

const NOW = new Date("2030-01-10T12:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const PAID = 10_000; // R$ 100,00

describe("computeCancellationOutcome (cliente cancela)", () => {
  const run = (hours: number, status: "pending" | "confirmed" = "confirmed") =>
    computeCancellationOutcome({
      actor: "client",
      status,
      start: inHours(hours),
      paidCents: PAID,
      now: NOW,
    });

  it("pedido ainda nao aceito: nada e retido, em qualquer horario", () => {
    for (const h of [100, 10, 1]) {
      expect(run(h, "pending")).toMatchObject({ tier: "unconfirmed", retainedCents: 0, refundCents: PAID });
    }
  });

  it("24h ou mais antes: sem custo", () => {
    expect(run(24)).toMatchObject({ tier: "free", retainedCents: 0, refundCents: PAID });
    expect(run(72)).toMatchObject({ tier: "free", retainedCents: 0 });
  });

  it("entre 24h e 2h: retem 20%", () => {
    expect(run(23.99)).toMatchObject({ tier: "mid", retentionPercent: 20, retainedCents: 2000, refundCents: 8000 });
    expect(run(2)).toMatchObject({ tier: "mid", retainedCents: 2000 });
  });

  it("menos de 2h: retem 30%", () => {
    expect(run(1.99)).toMatchObject({ tier: "late", retentionPercent: 30, retainedCents: 3000, refundCents: 7000 });
    expect(run(0.1)).toMatchObject({ tier: "late", retainedCents: 3000 });
  });

  it("arredonda em centavos e a soma sempre fecha o valor pago", () => {
    const out = computeCancellationOutcome({
      actor: "client",
      status: "confirmed",
      start: inHours(5),
      paidCents: 3333,
      now: NOW,
    });
    expect(out.retainedCents + out.refundCents).toBe(3333);
  });
});

describe("cancelamento pelo profissional ou sistema", () => {
  it.each(["professional", "system"] as const)("%s: reembolso total mesmo em cima da hora", (actor) => {
    const out = computeCancellationOutcome({
      actor,
      status: "confirmed",
      start: inHours(0.5),
      paidCents: PAID,
      now: NOW,
    });
    expect(out).toMatchObject({ tier: "full_refund", retainedCents: 0, refundCents: PAID });
  });
});

describe("retentionFor", () => {
  it("nao depende do valor pago", () => {
    expect(retentionFor({ actor: "client", status: "confirmed", start: inHours(5), now: NOW })).toEqual({
      tier: "mid",
      retentionPercent: 20,
    });
  });
});

describe("assertCanCancel", () => {
  it("aceita pendente e confirmado antes do inicio", () => {
    expect(() => assertCanCancel("pending", inHours(5), NOW)).not.toThrow();
    expect(() => assertCanCancel("confirmed", inHours(5), NOW)).not.toThrow();
  });

  it.each(["completed", "canceled", "no_show"] as const)("recusa status %s", (status) => {
    expect(() => assertCanCancel(status, inHours(5), NOW)).toThrow(HttpError);
  });

  it("recusa depois que o atendimento comecou", () => {
    expect(() => assertCanCancel("confirmed", inHours(-1), NOW)).toThrow(HttpError);
  });
});

describe("assertCanMarkNoShow", () => {
  it("exige 15 minutos de tolerancia", () => {
    expect(() => assertCanMarkNoShow(inHours(-0.2), NOW)).toThrow(HttpError); // 12 min
    expect(() => assertCanMarkNoShow(inHours(-0.25), NOW)).not.toThrow(); // 15 min
    expect(() => assertCanMarkNoShow(inHours(1), NOW)).toThrow(HttpError);
  });
});

describe("assertCanReschedule", () => {
  it("exige 24h de antecedencia", () => {
    expect(() => assertCanReschedule("confirmed", inHours(23), NOW)).toThrow(HttpError);
    expect(() => assertCanReschedule("confirmed", inHours(24), NOW)).not.toThrow();
  });
  it("recusa status finais", () => {
    expect(() => assertCanReschedule("completed", inHours(100), NOW)).toThrow(HttpError);
  });
});

describe("assertCanDispute", () => {
  it("concluido: dentro de 7 dias a partir da conclusao", () => {
    const completedAt = new Date(NOW.getTime() - 6 * 24 * 3_600_000);
    expect(() =>
      assertCanDispute({ status: "completed", start: completedAt, completedAt, now: NOW }),
    ).not.toThrow();
    const old = new Date(NOW.getTime() - 8 * 24 * 3_600_000);
    expect(() =>
      assertCanDispute({ status: "completed", start: old, completedAt: old, now: NOW }),
    ).toThrow(HttpError);
  });

  it("nao comparecimento pode ser contestado", () => {
    expect(() => assertCanDispute({ status: "no_show", start: inHours(-24), now: NOW })).not.toThrow();
  });

  it("confirmado so apos 2h do horario marcado (profissional ausente)", () => {
    expect(() => assertCanDispute({ status: "confirmed", start: inHours(-1), now: NOW })).toThrow(HttpError);
    expect(() => assertCanDispute({ status: "confirmed", start: inHours(-3), now: NOW })).not.toThrow();
  });

  it.each(["pending", "canceled"] as const)("recusa status %s", (status) => {
    expect(() => assertCanDispute({ status, start: inHours(-30), now: NOW })).toThrow(HttpError);
  });
});

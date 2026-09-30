/**
 * Pagamentos via Stripe e criacao do agendamento pago.
 *
 * Regras de seguranca:
 * - o valor cobrado e sempre calculado no servidor a partir do servico;
 * - o PaymentIntent carrega o id do usuario que o criou, e so esse usuario
 *   pode confirma-lo;
 * - a confirmacao e idempotente: o mesmo PaymentIntent nunca gera dois
 *   agendamentos.
 *
 * Ciclo do dinheiro (autorizar agora, cobrar so quando o profissional aceita):
 * 1. o cliente confirma o cartao -> Stripe "requires_capture" (valor reservado);
 * 2. profissional aceita -> capturePayment() cobra de fato;
 * 3. profissional recusa / pedido expira -> settleUnusedPayment() libera a
 *    reserva (nada e cobrado, sem taxa de estorno).
 * Se o valor ja tiver sido capturado, settleUnusedPayment() faz o estorno.
 */
import Stripe from "stripe";
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import { ServiceModel } from "../models/Service";
import { AddressModel } from "../models/Address";
import { UserModel } from "../models/User";
import { getStripe } from "../config/stripe";
import { HttpError } from "../errors/HttpError";
import { ensureChatRoomForAppointment } from "../utils/chatRoom";
import logger from "../utils/logger";
import { syncBotSessionsForAppointmentStatus } from "./botAppointmentStatus.service";
import { AppointmentRefundModel } from "../models/AppointmentRefund";
import { enqueuePaymentRefund, settleQueuedPayment } from "./appointmentRefund.service";
import {
  assertNoAppointmentOverlap,
  ScheduleConflictError,
  withProfessionalScheduleLock,
} from "./appointmentSchedule.service";

import { errorMessage } from "../utils/errors.util";
import { PaymentSettlementOperations } from "./payment/settlement";
export type { PaymentSettlement, PaymentSplit } from "./payment/settlement";
import type { PaymentSplit } from "./payment/settlement";
const CURRENCY = "brl";


interface PaymentIntentParams {
  amount: number;
  currency: string;
  metadata?: { [key: string]: string | number | null };
}

export interface BookingPaymentInput {
  professionalId: unknown;
  serviceId: unknown;
  selectedTime: unknown;
  addressId: unknown;
  appointmentId?: unknown;
}

/** Preco do servico em centavos (inteiro). */
export function servicePriceInCents(service: {
  price?: number | string | null;
  price_cents?: number | null;
}): number {
  if (service.price_cents && service.price_cents > 0) {
    return Math.round(service.price_cents);
  }
  const cents = Math.round(Number(service.price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw HttpError.badRequest("Serviço sem preço válido para pagamento");
  }
  return cents;
}

async function requireOwnedAddress(userId: number, addressId: unknown) {
  const id = Number(addressId);
  const address = Number.isInteger(id) ? await AddressModel.findByPk(id) : null;
  if (!address || address.user_id !== userId) {
    throw HttpError.notFound("Endereço do cliente não encontrado");
  }
  return address;
}

async function requireClient(userId: number) {
  const client = await ClientModel.findOne({ where: { user_id: userId } });
  if (!client) throw HttpError.forbidden("Cliente não encontrado para o usuário.");
  return client;
}

/**
 * Agendamento pre-existente (criado pelo chatbot) que o usuario vai pagar.
 * Precisa ser do proprio cliente, estar pendente e ainda nao pago.
 */
/**
 * Agendamento ja existente (ex.: pre-criado pelo chatbot) que o cliente vai
 * pagar. Aceita o identificador publico do app (short_id) ou a chave numerica.
 */
async function requirePayableAppointment(userId: number, appointmentId: unknown) {
  const client = await requireClient(userId);
  const raw = String(appointmentId ?? "").trim();
  const appointment =
    (raw ? await AppointmentModel.findOne({ where: { short_id: raw.toUpperCase() } }) : null) ??
    (/^\d+$/.test(raw) ? await AppointmentModel.findByPk(Number(raw)) : null);
  if (!appointment || appointment.client_id !== client.id) {
    throw HttpError.notFound("Agendamento não encontrado");
  }
  if (appointment.status !== "pending") {
    throw HttpError.badRequest(
      `Não é possível pagar um agendamento com status '${appointment.status}'`,
    );
  }
  if (appointment.payment_intent_id) {
    throw HttpError.conflict("Este agendamento já foi pago");
  }
  return appointment;
}

/** Resultado da confirmacao calculado dentro da trava (erros saem depois do commit). */
type ConfirmOutcome =
  | { appointment: AppointmentModel; created: boolean; changed: boolean; title?: string }
  | { error: HttpError; compensated: boolean };

function rejected(error: HttpError): ConfirmOutcome {
  return { error, compensated: false };
}

async function notifyPaymentConfirmation(
  userId: number,
  appointment: AppointmentModel,
  serviceTitle: string,
  isNewAppointment: boolean,
) {
  // Import tardio: evita ciclo payment.service <-> appointment.service.
  const notifications = await import("./appointment/appointment.notifications");
  if (!isNewAppointment) {
    await notifications.notifyPaymentConfirmed(
      userId,
      appointment.id,
      serviceTitle,
      appointment.start_time,
    );
    return;
  }
  const { ProfessionalModel } = await import("../models/Professional");
  const [professional, user] = await Promise.all([
    ProfessionalModel.findByPk(appointment.professional_id, { attributes: ["user_id"] }),
    UserModel.findByPk(userId, { attributes: ["id", "name"] }),
  ]);
  await notifications.notifyAppointmentCreated({
    appointmentId: appointment.id,
    startTime: appointment.start_time,
    serviceTitle,
    clientUserId: userId,
    clientName: user?.name,
    professionalUserId: professional?.user_id,
  });
}

export const PaymentService = {
  ...PaymentSettlementOperations,

  /** Cria um PaymentIntent no Stripe e retorna o client_secret. */
  createPaymentIntent: async ({
    amount,
    currency,
    metadata,
  }: PaymentIntentParams): Promise<string> => {
    try {
      const paymentIntent = await getStripe().paymentIntents.create({
        amount: Math.round(amount),
        currency,
        automatic_payment_methods: { enabled: true },
        // Reserva o valor no cartao; a cobranca so ocorre na aceitacao.
        capture_method: "manual",
        metadata: metadata as Stripe.MetadataParam,
      });

      if (!paymentIntent.client_secret) {
        throw new Error("Falha ao obter o identificador de pagamento do provedor.");
      }
      return paymentIntent.client_secret;
    } catch (error) {
      logger.error("[PaymentService] Erro na API do Stripe ao criar Payment Intent", {
        reason: errorMessage(error),
      });
      throw new Error(
        `Erro ao iniciar o processo de pagamento: ${
          errorMessage(error, "Erro desconhecido do provedor de pagamento.")
        }`,
      );
    }
  },

  /**
   * Inicia o pagamento de um agendamento. O valor vem do preco do servico
   * (nunca do cliente) e o PaymentIntent fica vinculado ao usuario.
   */
  createBookingPaymentIntent: async (
    userId: number,
    input: BookingPaymentInput,
  ): Promise<string> => {
    const { validateBookingRequest } = await import("./appointment/appointment.service");

    let service: ServiceModel;
    let professionalId: number;
    let startIso: string;
    let payable: AppointmentModel | null = null;

    if (input.appointmentId) {
      const appointment = await requirePayableAppointment(userId, input.appointmentId);
      payable = appointment;
      await requireOwnedAddress(userId, input.addressId);
      const found = await ServiceModel.findByPk(appointment.service_id);
      if (!found) throw HttpError.notFound("Serviço não encontrado");
      service = found;
      professionalId = appointment.professional_id;
      startIso = appointment.start_time.toISOString();
    } else {
      if (!input.professionalId || !input.selectedTime || !input.serviceId || !input.addressId) {
        throw HttpError.badRequest(
          "Dados do agendamento (professionalId, selectedTime, serviceId, addressId) são obrigatórios.",
        );
      }
      const start = new Date(String(input.selectedTime));
      const validated = await validateBookingRequest({
        userId,
        professionalId: Number(input.professionalId),
        serviceId: Number(input.serviceId),
        addressId: Number(input.addressId),
        start,
      });
      service = validated.service;
      professionalId = validated.professional.id;
      startIso = start.toISOString();
    }

    // Reserva existente cobra o preco combinado nela (o mesmo conferido na confirmacao).
    const amount =
      payable?.final_price != null
        ? Math.round(Number(payable.final_price) * 100)
        : servicePriceInCents(service);

    return PaymentService.createPaymentIntent({
      amount,
      currency: CURRENCY,
      metadata: {
        userId: String(userId),
        professionalId: String(professionalId),
        serviceId: String(service.id),
        selectedTime: startIso,
        addressId: String(Number(input.addressId)),
        ...(payable ? { appointmentId: String(payable.id) } : {}),
      },
    });
  },

  /**
   * Confirma o pagamento e cria (ou vincula) o agendamento.
   * Idempotente: repetir a chamada devolve o mesmo agendamento.
   *
   * Tudo roda sob a trava da agenda do profissional. Se a reserva nao puder ser
   * gravada (horario ocupado, valor divergente, agendamento cancelado...), o
   * pagamento entra na fila de devolucao no mesmo commit e o erro so e
   * devolvido depois dele; em seguida tentamos liberar o valor na hora.
   */
  confirmAndCreateAppointment: async (
    paymentIntentId: string,
    authenticatedUserId: number,
  ): Promise<AppointmentModel> => {
    if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      throw HttpError.badRequest("O ID do pagamento (paymentIntentId) é inválido.");
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      throw HttpError.badRequest(`Erro ao verificar pagamento: ${errorMessage(error)}`);
    }

    const metadata = paymentIntent.metadata || {};
    if (Number(metadata.userId) !== authenticatedUserId) {
      throw HttpError.forbidden("Este pagamento não pertence ao usuário autenticado.").withCode(
        "PAYMENT_NOT_OWNED",
      );
    }

    const professionalId = Number(metadata.professionalId);
    const serviceId = Number(metadata.serviceId);
    const addressId = Number(metadata.addressId);
    const startTime = new Date(String(metadata.selectedTime));
    if (
      ![professionalId, serviceId, addressId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      Number.isNaN(startTime.getTime())
    ) {
      throw new HttpError(422, "Dados do agendamento ausentes nos metadados do pagamento.").withCode(
        "INVALID_METADATA",
      );
    }

    const client = await requireClient(authenticatedUserId);
    // "requires_capture" = valor reservado; "succeeded" cobre pagamentos antigos.
    const authorized = ["requires_capture", "succeeded"].includes(paymentIntent.status);

    const outcome = await withProfessionalScheduleLock<ConfirmOutcome>(
      professionalId,
      async (transaction) => {
        // Repeticoes sao reconhecidas antes do estado atual da reserva.
        const linked = await AppointmentModel.findOne({
          where: { payment_intent_id: paymentIntentId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (linked) {
          if (linked.client_id !== client.id) {
            return rejected(
              HttpError.forbidden("Pagamento pertence a outro cliente.").withCode("PAYMENT_NOT_OWNED"),
            );
          }
          return { appointment: linked, created: false, changed: false };
        }
        if (!authorized) {
          return rejected(HttpError.badRequest("O pagamento não foi autorizado."));
        }

        // Um pagamento destinado a devolucao nao pode voltar a financiar uma reserva.
        const refund = await AppointmentRefundModel.findOne({
          where: { payment_intent_id: paymentIntentId },
          transaction,
        });
        if (refund) {
          return rejected(
            HttpError.conflict(
              "Este pagamento está em processo de devolução ou já foi devolvido.",
            ).withCode("PAYMENT_REFUND_PENDING"),
          );
        }

        const existing = metadata.appointmentId
          ? await AppointmentModel.findOne({
              where: { id: Number(metadata.appointmentId), client_id: client.id },
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          : null;

        const compensate = async (error: HttpError): Promise<ConfirmOutcome> => {
          await enqueuePaymentRefund(paymentIntentId, existing?.id ?? null, transaction);
          return { error, compensated: true };
        };

        if (metadata.appointmentId) {
          if (!existing) {
            return compensate(
              HttpError.notFound(
                "Agendamento não encontrado ou não pertence a este usuário.",
              ).withCode("APPOINTMENT_NOT_OWNED"),
            );
          }
          if (existing.professional_id !== professionalId || existing.service_id !== serviceId) {
            return compensate(
              HttpError.conflict(
                "Pagamento não corresponde ao serviço e profissional da reserva.",
              ).withCode("APPOINTMENT_MISMATCH"),
            );
          }
          if (existing.payment_intent_id) {
            return compensate(
              HttpError.conflict("Este agendamento já possui outro pagamento registrado.").withCode(
                "APPOINTMENT_ALREADY_PAID",
              ),
            );
          }
          if (existing.status !== "pending") {
            return compensate(
              HttpError.conflict("Este agendamento não pode mais receber pagamento.").withCode(
                "APPOINTMENT_NOT_PAYABLE",
              ),
            );
          }
        }

        const service = await ServiceModel.findByPk(serviceId, { transaction });
        if (!service?.active || service.professional_id !== professionalId) {
          return compensate(
            HttpError.conflict("Serviço indisponível para receber pagamento.").withCode(
              "SERVICE_UNAVAILABLE",
            ),
          );
        }
        const expectedCents =
          existing?.final_price != null
            ? Math.round(Number(existing.final_price) * 100)
            : servicePriceInCents(service);
        if (paymentIntent.amount !== expectedCents) {
          return compensate(
            new HttpError(
              422,
              "O valor do pagamento não corresponde ao valor do serviço contratado.",
            ).withCode("AMOUNT_MISMATCH"),
          );
        }

        if (existing) {
          existing.payment_intent_id = paymentIntentId;
          existing.address_id = addressId;
          existing.final_price ??= expectedCents / 100;
          await existing.save({ transaction });
          return { appointment: existing, created: false, changed: true, title: service.title };
        }

        const endTime = new Date(startTime.getTime() + (service.duration || 60) * 60_000);
        try {
          await assertNoAppointmentOverlap(professionalId, startTime, endTime, transaction);
        } catch (error) {
          if (error instanceof ScheduleConflictError) {
            return compensate(
              new ScheduleConflictError(`${error.message} Nenhum valor foi cobrado.`),
            );
          }
          throw error;
        }
        const appointment = await AppointmentModel.create(
          {
            professional_id: professionalId,
            client_id: client.id,
            service_id: serviceId,
            address_id: addressId,
            start_time: startTime,
            end_time: endTime,
            status: "pending",
            payment_intent_id: paymentIntentId,
            final_price: expectedCents / 100,
          },
          { transaction },
        );
        return { appointment, created: true, changed: true, title: service.title };
      },
    );

    if ("error" in outcome) {
      // Depois do commit: tenta liberar a reserva agora; se falhar, o cron repete.
      if (outcome.compensated) await settleQueuedPayment(paymentIntentId);
      throw outcome.error;
    }
    const { appointment, created, changed, title } = outcome;
    if (!changed) return appointment;

    // Efeitos posteriores ao commit nunca desfazem o pagamento ja vinculado.
    if (created) {
      try {
        await ensureChatRoomForAppointment(appointment);
      } catch (error) {
        logger.warn("[PaymentService] Falha ao criar chat após confirmação", {
          reason: errorMessage(error),
        });
      }
    }
    try {
      await notifyPaymentConfirmation(authenticatedUserId, appointment, title ?? "", created);
    } catch (error) {
      logger.warn("[PaymentService] Falha ao notificar pagamento confirmado", {
        reason: errorMessage(error),
      });
    }
    try {
      await syncBotSessionsForAppointmentStatus(appointment);
    } catch (syncError) {
      logger.warn("[PaymentService] Falha ao sincronizar status no chatbot", {
        reason: errorMessage(syncError),
      });
    }
    return appointment;
  },

  /** Busca o recibo (receipt_url) do pagamento via Stripe. */
  getAppointmentReceipt: async (
    appointmentId: number,
    authenticatedUserId: number,
  ): Promise<string> => {
    const client = await requireClient(authenticatedUserId);
    const appointment = await AppointmentModel.findOne({
      where: { id: appointmentId, client_id: client.id },
    });
    if (!appointment) {
      throw HttpError.notFound("Agendamento não encontrado ou não pertence a este usuário.");
    }
    if (!appointment.payment_intent_id) {
      throw HttpError.notFound("Este agendamento não possui um recibo de pagamento online.");
    }

    const paymentIntent = await getStripe().paymentIntents.retrieve(
      appointment.payment_intent_id,
      { expand: ["latest_charge"] },
    );
    const receiptUrl = (paymentIntent.latest_charge as Stripe.Charge | null)?.receipt_url;
    if (!receiptUrl) {
      throw HttpError.notFound("O recibo para este pagamento não está disponível.");
    }
    return receiptUrl;
  },

};

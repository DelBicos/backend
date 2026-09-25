/**
 * Pagamentos via Stripe e criacao do agendamento pago.
 *
 * Regras de seguranca:
 * - o valor cobrado e sempre calculado no servidor a partir do servico;
 * - o PaymentIntent carrega o id do usuario que o criou, e so esse usuario
 *   pode confirma-lo;
 * - a confirmacao e idempotente: o mesmo PaymentIntent nunca gera dois
 *   agendamentos.
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
async function requirePayableAppointment(userId: number, appointmentId: unknown) {
  const client = await requireClient(userId);
  const id = Number(appointmentId);
  const appointment = Number.isInteger(id) ? await AppointmentModel.findByPk(id) : null;
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
        metadata: metadata as Stripe.MetadataParam,
      });

      if (!paymentIntent.client_secret) {
        throw new Error("Falha ao obter o identificador de pagamento do provedor.");
      }
      return paymentIntent.client_secret;
    } catch (error: any) {
      logger.error("[PaymentService] Erro na API do Stripe ao criar Payment Intent", {
        reason: error?.message,
      });
      throw new Error(
        `Erro ao iniciar o processo de pagamento: ${
          error.message || "Erro desconhecido do provedor de pagamento."
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

    if (input.appointmentId) {
      const appointment = await requirePayableAppointment(userId, input.appointmentId);
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

    return PaymentService.createPaymentIntent({
      amount: servicePriceInCents(service),
      currency: CURRENCY,
      metadata: {
        userId: String(userId),
        professionalId: String(professionalId),
        serviceId: String(service.id),
        selectedTime: startIso,
        addressId: String(Number(input.addressId)),
        ...(input.appointmentId ? { appointmentId: String(Number(input.appointmentId)) } : {}),
      },
    });
  },

  /**
   * Confirma o pagamento e cria (ou vincula) o agendamento.
   * Idempotente: repetir a chamada devolve o mesmo agendamento.
   */
  confirmAndCreateAppointment: async (
    paymentIntentId: string,
    authenticatedUserId: number,
  ): Promise<AppointmentModel> => {
    if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      throw HttpError.badRequest("O ID do pagamento (paymentIntentId) é inválido.");
    }

    const alreadyLinked = await AppointmentModel.findOne({
      where: { payment_intent_id: paymentIntentId },
    });

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    } catch (error: any) {
      throw HttpError.badRequest(`Erro ao verificar pagamento: ${error.message}`);
    }

    const metadata = paymentIntent.metadata || {};
    if (Number(metadata.userId) !== authenticatedUserId) {
      throw HttpError.forbidden("Este pagamento não pertence ao usuário autenticado.");
    }
    if (alreadyLinked) return alreadyLinked;

    if (paymentIntent.status !== "succeeded") {
      throw HttpError.badRequest("O pagamento não foi concluído com sucesso.");
    }

    const { professionalId, serviceId, selectedTime, addressId } = metadata;
    if (!professionalId || !serviceId || !selectedTime || !addressId) {
      throw HttpError.badRequest("Dados do agendamento ausentes nos metadados do pagamento.");
    }

    const [client, service] = await Promise.all([
      requireClient(authenticatedUserId),
      ServiceModel.findByPk(Number(serviceId)),
    ]);
    if (!service) throw HttpError.notFound("Serviço não encontrado.");

    let appointment: AppointmentModel;
    let isNewAppointment = false;
    try {
      if (metadata.appointmentId) {
        const existing = await AppointmentModel.findByPk(Number(metadata.appointmentId));
        if (!existing || existing.client_id !== client.id) {
          throw HttpError.notFound("Agendamento pré-existente não encontrado.");
        }
        existing.payment_intent_id = paymentIntentId;
        existing.address_id = Number(addressId);
        await existing.save();
        appointment = existing;
      } else {
        const { assertProfessionalIsFree } = await import("./appointment/appointment.service");
        const startTime = new Date(selectedTime);
        const endTime = new Date(startTime.getTime() + (service.duration || 60) * 60_000);
        await assertProfessionalIsFree(Number(professionalId), startTime, endTime);

        appointment = await AppointmentModel.create({
          professional_id: Number(professionalId),
          client_id: client.id,
          service_id: Number(serviceId),
          address_id: Number(addressId),
          start_time: startTime,
          end_time: endTime,
          status: "pending",
          payment_intent_id: paymentIntentId,
        });
        isNewAppointment = true;
        await ensureChatRoomForAppointment(appointment);
      }
    } catch (error: any) {
      // Pagamento aprovado mas agendamento nao pode ser gravado: estorna.
      logger.error("[PaymentService] Falha ao gravar agendamento pago; estornando", {
        paymentIntentId,
        reason: error?.message,
      });
      await PaymentService.refundPaymentIntent(paymentIntentId);
      if (error instanceof HttpError) {
        throw new HttpError(
          error.status,
          `${error.message} O pagamento foi estornado.`,
        );
      }
      throw new Error("Erro ao salvar o agendamento no banco de dados.");
    }

    await notifyPaymentConfirmation(
      authenticatedUserId,
      appointment,
      service.title,
      isNewAppointment,
    );

    try {
      // O pagamento ja foi persistido; falha no push nao desfaz nada.
      await syncBotSessionsForAppointmentStatus(appointment);
    } catch (syncError: any) {
      logger.warn("[PaymentService] Falha ao sincronizar status no chatbot", {
        reason: syncError?.message,
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

  refundPaymentIntent: async (paymentIntentId: string): Promise<boolean> => {
    try {
      await getStripe().refunds.create({ payment_intent: paymentIntentId });
      logger.info("[PaymentService] Reembolso acionado no Stripe", { paymentIntentId });
      return true;
    } catch (error: any) {
      logger.error("[PaymentService] Erro ao processar reembolso no Stripe", {
        paymentIntentId,
        reason: error?.message,
      });
      return false;
    }
  },
};

import Stripe from "stripe";
import * as dotenv from "dotenv";
import { AppointmentModel, IAppointment } from "../models/Appointment";
import { UserModel } from "../models/User";
import { ClientModel } from "../models/Client";
import { NotificationModel } from "../models/Notification";
import { ServiceModel } from "../models/Service";
import { ensureChatRoomForAppointment } from "../utils/chatRoom";
import { customAlphabet } from "nanoid";
import { syncBotSessionsForAppointmentStatus } from "./botAppointmentStatus.service";
import { assertNoAppointmentOverlap, ScheduleConflictError, withProfessionalScheduleLock } from "./appointmentSchedule.service";
import { AppointmentRefundModel } from "../models/AppointmentRefund";
import { enqueuePaymentRefund } from "./appointmentRefund.service";

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey || !stripeSecretKey.startsWith("sk_")) {
  const errorMsg = "FATAL ERROR: STRIPE_SECRET_KEY não definida corretamente.";
  console.error(errorMsg);
  throw new Error(errorMsg);
}

const stripe = new Stripe(stripeSecretKey, { typescript: true });

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const generateShortId = customAlphabet(alphabet, 6);

const generateUniqueShortId = async (
  model: typeof AppointmentModel,
  transaction?: any,
  maxAttempts: number = 10,
): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shortId = generateShortId();
    const existing = await model.findOne({
      where: { short_id: shortId },
      transaction,
    });
    if (!existing) {
      return shortId;
    }
  }
  throw new Error(
    `Não foi possível gerar um short_id único após ${maxAttempts} tentativas.`,
  );
};

// Erro de validação de negócio (ownership/status/valor), com code+status estáveis
// para o cliente HTTP, sem depender de casamento de texto da mensagem.
export class PaymentValidationError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "PaymentValidationError";
    this.code = code;
    this.status = status;
  }
}

// ============================================================
// Interfaces
// ============================================================
interface PaymentIntentParams {
  amount: number;
  currency: string;
  metadata?: { [key: string]: string | number | null };
}

// ============================================================
// Serviço de Pagamento
// ============================================================
export const PaymentService = {
  /**
   * Cria um PaymentIntent no Stripe e retorna o client_secret.
   */
  createPaymentIntent: async ({
    amount,
    currency,
    metadata,
  }: PaymentIntentParams): Promise<string> => {
    try {
      // amount deve ser em centavos (inteiro)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount), // garante inteiro
        currency: currency,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: metadata,
      });

      if (!paymentIntent.client_secret) {
        console.error(
          "[PaymentService] Erro crítico: PaymentIntent criado sem client_secret.",
          paymentIntent,
        );
        throw new Error(
          "Falha ao obter o identificador de pagamento do provedor.",
        );
      }

      return paymentIntent.client_secret;
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro na API do Stripe ao criar Payment Intent:",
        error,
      );
      throw new Error(
        `Erro ao iniciar o processo de pagamento: ${
          error.message || "Erro desconhecido do provedor de pagamento."
        }`,
      );
    }
  },

  /**
   * Confirma o pagamento, valida o status e cria o agendamento.
   * Gera short_id automaticamente em UPPERCASE.
   */
  confirmAndCreateAppointment: async (
    paymentIntentId: string,
    authenticatedUserId: number,
  ): Promise<IAppointment> => {
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro ao buscar PaymentIntent no Stripe:",
        error.message,
      );
      throw new Error(`Erro ao verificar pagamento: ${error.message}`);
    }

    if (paymentIntent.status !== "succeeded") {
      console.warn(
        `[PaymentService] Tentativa de confirmação de pagamento não sucedido (Status: ${paymentIntent.status})`,
      );
      throw new Error("O pagamento não foi concluído com sucesso.");
    }

    const metadata = paymentIntent.metadata;
    const professionalId = metadata.professionalId;
    const serviceId = metadata.serviceId;
    const selectedTime = metadata.selectedTime;
    const addressId = metadata.addressId;

    if (!professionalId || !serviceId || !selectedTime || !addressId) {
      throw new Error(
        "Dados do agendamento ausentes nos metadados do pagamento.",
      );
    }

    // Valida cliente
    const user = await UserModel.findByPk(authenticatedUserId);
    if (!user) {
      throw new Error("Cliente (usuário) não encontrado.");
    }
    const client = await ClientModel.findOne({
      where: { user_id: authenticatedUserId },
    });
    if (!client) {
      throw new Error("Cliente não encontrado para o usuário.");
    }
    const clientId = client.id;

    const professionalIdNumber = Number(professionalId);
    const serviceIdNumber = Number(serviceId);
    const addressIdNumber = Number(addressId);
    if (![professionalIdNumber, serviceIdNumber, addressIdNumber].every(
      (id) => Number.isSafeInteger(id) && id > 0,
    )) throw new PaymentValidationError("Metadados do pagamento inválidos.", "INVALID_METADATA", 422);

    type Outcome =
      | { appointment: AppointmentModel; changed: boolean; created: boolean; title?: string }
      | { error: PaymentValidationError };

    const outcome = await withProfessionalScheduleLock<Outcome>(
      professionalIdNumber,
      async (transaction) => {
        // Repetições são reconhecidas antes do catálogo e do estado atual da reserva.
        // A remarcação pode ter alterado o horário; o pagamento continua sendo o mesmo.
        const linked = await AppointmentModel.findOne({
          where: { payment_intent_id: paymentIntentId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (linked) {
          if (linked.client_id !== clientId)
            throw new PaymentValidationError("Pagamento pertence a outro cliente.", "PAYMENT_NOT_OWNED", 403);
          return { appointment: linked, changed: false, created: false };
        }

        // Um pagamento destinado a estorno não pode voltar a financiar uma reserva.
        const refund = await AppointmentRefundModel.findOne({
          where: { payment_intent_id: paymentIntentId }, transaction,
        });
        if (refund)
          throw new PaymentValidationError("Este pagamento está em processo de estorno ou já foi estornado.", "PAYMENT_REFUND_PENDING", 409);

        let existing: AppointmentModel | null = null;
        if (metadata.appointmentId) {
          existing = await AppointmentModel.findOne({
            where: { id: Number(metadata.appointmentId), client_id: clientId },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!existing)
            throw new PaymentValidationError("Agendamento não encontrado ou não pertence a este usuário.", "APPOINTMENT_NOT_OWNED", 404);
          if (existing.professional_id !== professionalIdNumber || existing.service_id !== serviceIdNumber)
            throw new PaymentValidationError("Pagamento não corresponde ao serviço e profissional da reserva.", "APPOINTMENT_MISMATCH", 409);
        }

        // Retorna o erro somente DEPOIS do commit, para preservar a compensação.
        const compensate = async (message: string, code: string, status: number): Promise<Outcome> => {
          await enqueuePaymentRefund(paymentIntentId, existing?.id ?? null, transaction);
          return { error: new PaymentValidationError(message, code, status) };
        };
        if (existing?.payment_intent_id)
          return compensate("Este agendamento já possui outro pagamento registrado.", "APPOINTMENT_ALREADY_PAID", 409);
        if (existing && (existing.status === "completed" || existing.status === "canceled"))
          return compensate("Este agendamento não pode mais receber pagamento. O estorno será processado.", "APPOINTMENT_NOT_PAYABLE", 409);

        const service = await ServiceModel.findByPk(serviceIdNumber, { transaction });
        if (!service?.active || service.professional_id !== professionalIdNumber)
          return compensate("Serviço indisponível para receber pagamento.", "SERVICE_UNAVAILABLE", 409);

        const expectedAmountCents = existing?.final_price != null
          ? Math.round(Number(existing.final_price) * 100)
          : service.price_cents ?? Math.round(Number(service.price) * 100);
        const chargedAmountCents = paymentIntent.amount_received;
        if (!Number.isSafeInteger(expectedAmountCents) || expectedAmountCents <= 0 || chargedAmountCents !== expectedAmountCents)
          return compensate("O valor cobrado não corresponde ao valor do serviço contratado.", "AMOUNT_MISMATCH", 422);

        if (existing) {
          existing.payment_intent_id = paymentIntentId;
          existing.final_price ??= chargedAmountCents / 100;
          if (!existing.short_id) existing.short_id = await generateUniqueShortId(AppointmentModel, transaction);
          await existing.save({ transaction });
          return { appointment: existing, changed: true, created: false, title: service.title };
        }

        const startTime = new Date(selectedTime);
        const duration = service.duration || 60;
        const endTime = new Date(startTime.getTime() + duration * 60000);
        try {
          await assertNoAppointmentOverlap(professionalIdNumber, startTime, endTime, transaction);
        } catch (error) {
          if (error instanceof ScheduleConflictError)
            return compensate(error.message, "SCHEDULE_CONFLICT", 409);
          throw error;
        }
        const appointment = await AppointmentModel.create({
          professional_id: professionalIdNumber, client_id: clientId,
          service_id: serviceIdNumber, address_id: addressIdNumber,
          start_time: startTime, end_time: endTime, status: "pending",
          payment_intent_id: paymentIntentId, final_price: chargedAmountCents / 100,
          short_id: await generateUniqueShortId(AppointmentModel, transaction),
        }, { transaction });
        return { appointment, changed: true, created: true, title: service.title };
      },
    );

    if ("error" in outcome) throw outcome.error;
    const { appointment, changed, created, title } = outcome;
    if (!changed) return appointment;

    // Efeitos posteriores ao commit nunca provocam estorno do pagamento persistido.
    // Uma falha de banco/commit acima também não autoriza estorno às cegas:
    // repetir a confirmação consulta o vínculo ou a compensação já persistida.
    if (created) {
      try {
        await ensureChatRoomForAppointment(appointment);
      } catch (error) {
        console.error("[PaymentService] Falha ao criar chat após confirmação:", error);
      }
    }
    try {
      await NotificationModel.create({
        user_id: authenticatedUserId,
        title: created ? "Agendamento Criado com Sucesso" : "Pagamento Confirmado",
        message: `O pagamento para o serviço '${title}' foi confirmado. Acompanhe o status do agendamento.`,
        notification_type: "appointment", related_entity_id: appointment.id, is_read: false,
      });
    } catch (error) {
      console.error("[PaymentService] Falha ao notificar pagamento confirmado:", error);
    }
    try {
      await syncBotSessionsForAppointmentStatus(appointment);
    } catch (error) {
      console.error("[PaymentService] Falha ao sincronizar pagamento confirmado:", error);
    }
    return appointment;
  },

  /**
   * Busca o recibo (receipt_url) do pagamento via Stripe.
   */
  getAppointmentReceipt: async (
    appointmentId: number,
    authenticatedUserId: number,
  ): Promise<string> => {
    const client = await ClientModel.findOne({
      where: { user_id: authenticatedUserId },
    });
    if (!client) {
      throw new Error("Cliente não encontrado.");
    }

    const appointment = await AppointmentModel.findOne({
      where: {
        id: appointmentId,
        client_id: client.id,
      },
    });

    if (!appointment) {
      throw new Error(
        "Agendamento não encontrado ou não pertence a este usuário.",
      );
    }

    const paymentIntentId = appointment.payment_intent_id;
    if (!paymentIntentId) {
      throw new Error(
        "Este agendamento não possui um recibo de pagamento online.",
      );
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        {
          expand: ["latest_charge"],
        },
      );

      const latestCharge = paymentIntent.latest_charge as Stripe.Charge;
      const receiptUrl = latestCharge?.receipt_url;

      if (!receiptUrl) {
        console.warn(
          `[PaymentService] Não foi encontrado receipt_url. Status do PI: ${paymentIntent.status}, Status da Cobrança: ${latestCharge?.status}`,
        );
        throw new Error("O recibo para este pagamento não está disponível.");
      }

      return receiptUrl;
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro ao buscar recibo no Stripe:",
        error.message,
      );
      throw new Error(`Erro ao buscar recibo: ${error.message}`);
    }
  },

  refundPaymentIntent: async (paymentIntentId: string): Promise<boolean> => {
    try {
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      console.log(
        `[PaymentService] Reembolso acionado com sucesso no Stripe para PI: ${paymentIntentId}`,
      );
      return true;
    } catch (error: any) {
      console.error(
        `[PaymentService] Erro ao processar reembolso no Stripe para PI: ${paymentIntentId}`,
        error.message,
      );
      return false;
    }
  },
};

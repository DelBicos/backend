import Stripe from "stripe";
import * as dotenv from "dotenv";
import { AppointmentModel, IAppointment } from "../models/Appointment";
import { UserModel } from "../models/User";
import { ClientModel } from "../models/Client";
import { NotificationModel } from "../models/Notification";
import { ServiceModel } from "../models/Service";
import { ensureChatRoomForAppointment } from "../utils/chatRoom";
import { customAlphabet } from 'nanoid';

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey || !stripeSecretKey.startsWith("sk_")) {
  const errorMsg = "FATAL ERROR: STRIPE_SECRET_KEY não definida corretamente.";
  console.error(errorMsg);
  throw new Error(errorMsg);
}

const stripe = new Stripe(stripeSecretKey, { typescript: true });

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateShortId = customAlphabet(alphabet, 6);

const generateUniqueShortId = async (
  model: typeof AppointmentModel,
  transaction?: any,
  maxAttempts: number = 10
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
  throw new Error(`Não foi possível gerar um short_id único após ${maxAttempts} tentativas.`);
};

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
        amount: Math.round(amount),   // garante inteiro
        currency: currency,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: metadata,
      });

      if (!paymentIntent.client_secret) {
        console.error(
          "[PaymentService] Erro crítico: PaymentIntent criado sem client_secret.",
          paymentIntent
        );
        throw new Error("Falha ao obter o identificador de pagamento do provedor.");
      }

      return paymentIntent.client_secret;
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro na API do Stripe ao criar Payment Intent:",
        error
      );
      throw new Error(
        `Erro ao iniciar o processo de pagamento: ${
          error.message || "Erro desconhecido do provedor de pagamento."
        }`
      );
    }
  },

  /**
   * Confirma o pagamento, valida o status e cria o agendamento.
   * Gera short_id automaticamente em UPPERCASE.
   */
  confirmAndCreateAppointment: async (
    paymentIntentId: string,
    authenticatedUserId: number
  ): Promise<IAppointment> => {
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro ao buscar PaymentIntent no Stripe:",
        error.message
      );
      throw new Error(`Erro ao verificar pagamento: ${error.message}`);
    }

    if (paymentIntent.status !== "succeeded") {
      console.warn(
        `[PaymentService] Tentativa de confirmação de pagamento não sucedido (Status: ${paymentIntent.status})`
      );
      throw new Error("O pagamento não foi concluído com sucesso.");
    }

    const metadata = paymentIntent.metadata;
    const professionalId = metadata.professionalId;
    const serviceId = metadata.serviceId;
    const selectedTime = metadata.selectedTime;
    const addressId = metadata.addressId;

    if (!professionalId || !serviceId || !selectedTime || !addressId) {
      throw new Error("Dados do agendamento ausentes nos metadados do pagamento.");
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

    // Busca serviço
    const service = await ServiceModel.findByPk(Number(serviceId));
    if (!service) {
      throw new Error("Serviço não encontrado.");
    }

    const startTime = new Date(selectedTime);
    const durationMinutes = service.duration || 60;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    // ============================================================
    // Geração do short_id (UPPERCASE, 6 caracteres)
    // ============================================================
    let shortId: string;
    try {
      shortId = await generateUniqueShortId(AppointmentModel);
    } catch (err) {
      console.error("[PaymentService] Erro ao gerar short_id, usando fallback:", err);
      shortId = generateShortId();
      // Verificação extra para evitar colisão
      const existing = await AppointmentModel.findOne({ where: { short_id: shortId } });
      if (existing) {
        throw new Error("Falha crítica: não foi possível gerar um short_id único.");
      }
    }

    // ============================================================
    // Criação do agendamento
    // ============================================================
    try {
      const newAppointment = await AppointmentModel.create({
        professional_id: Number(professionalId),
        client_id: clientId,
        service_id: Number(serviceId),
        address_id: Number(addressId),
        start_time: startTime,
        end_time: endTime,
        status: "pending",
        payment_intent_id: paymentIntentId,
        short_id: shortId,
      });

      // Cria sala de chat
      await ensureChatRoomForAppointment(newAppointment);

      // Notificação para o cliente
      await NotificationModel.create({
        user_id: authenticatedUserId, // ou client.user_id
        title: "Agendamento Criado com Sucesso",
        message: `Seu agendamento para o serviço '${service.title}' no dia ${selectedTime} foi criado. Aguardando confirmação do profissional.`,
        notification_type: "appointment",
        related_entity_id: newAppointment.id,
        is_read: false,
      });

      // Opcional: notificar o profissional (como na criação via controller)
      // ...

      return newAppointment;
    } catch (dbError: any) {
      console.error(
        "[PaymentService] Erro ao salvar agendamento no DB:",
        dbError.message
      );

      // Tenta reembolsar o pagamento em caso de falha no banco
      try {
        await stripe.refunds.create({ payment_intent: paymentIntentId });
        console.log(`[PaymentService] Reembolso solicitado para PI: ${paymentIntentId}`);
      } catch (refundError: any) {
        console.error(
          `[PaymentService] FALHA CRÍTICA: Não foi possível criar o agendamento E não foi possível processar o reembolso. PI: ${paymentIntentId}`,
          refundError.message
        );
      }
      throw new Error("Erro ao salvar o agendamento no banco de dados.");
    }
  },

  /**
   * Busca o recibo (receipt_url) do pagamento via Stripe.
   */
  getAppointmentReceipt: async (
    appointmentId: number, // ainda pode ser o ID numérico interno, mas futuramente podemos usar short_id
    authenticatedUserId: number
  ): Promise<string> => {
    const client = await ClientModel.findOne({
      where: { user_id: authenticatedUserId },
    });
    if (!client) {
      throw new Error("Cliente não encontrado.");
    }

    const appointment = await AppointmentModel.findOne({
      where: {
        id: appointmentId,   // mantenha id interno para consulta
        client_id: client.id,
      },
    });

    if (!appointment) {
      throw new Error("Agendamento não encontrado ou não pertence a este usuário.");
    }

    const paymentIntentId = appointment.payment_intent_id;
    if (!paymentIntentId) {
      throw new Error("Este agendamento não possui um recibo de pagamento online.");
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        {
          expand: ["latest_charge"],
        }
      );

      const latestCharge = paymentIntent.latest_charge as Stripe.Charge;
      const receiptUrl = latestCharge?.receipt_url;

      if (!receiptUrl) {
        console.warn(
          `[PaymentService] Não foi encontrado receipt_url. Status do PI: ${paymentIntent.status}, Status da Cobrança: ${latestCharge?.status}`
        );
        throw new Error("O recibo para este pagamento não está disponível.");
      }

      return receiptUrl;
    } catch (error: any) {
      console.error(
        "[PaymentService] Erro ao buscar recibo no Stripe:",
        error.message
      );
      throw new Error(`Erro ao buscar recibo: ${error.message}`);
    }
  },
};
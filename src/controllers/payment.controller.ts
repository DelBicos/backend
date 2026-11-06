import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { PaymentService } from "../services/payment.service";

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

/**
 * Inicia o pagamento de um agendamento.
 * Campos "amount" e "currency" enviados pelo app sao ignorados: o valor e
 * calculado no servidor a partir do preco do servico.
 */
export const createPaymentIntentController = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { professionalId, selectedTime, serviceId, addressId, appointmentId } =
      req.body ?? {};
    const clientSecret = await PaymentService.createBookingPaymentIntent(
      requireUserId(req),
      { professionalId, selectedTime, serviceId, addressId, appointmentId },
    );
    res.status(200).json({ clientSecret });
  },
);

/**
 * Confirma o pagamento e cria o agendamento para o usuario do token.
 * O campo "userId" do corpo (enviado por versoes antigas do app) e ignorado.
 */
export const confirmPaymentController = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { paymentIntentId } = req.body ?? {};
    if (!paymentIntentId) {
      throw HttpError.badRequest("O ID do pagamento (paymentIntentId) é obrigatório.");
    }
    const appointment = await PaymentService.confirmAndCreateAppointment(
      String(paymentIntentId),
      requireUserId(req),
    );
    res.status(201).json({
      message: "Agendamento criado com sucesso!",
      appointment,
    });
  },
);

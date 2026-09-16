import { Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

export const createPaymentIntentController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    amount,
    currency,
    professionalId,
    selectedTime,
    serviceId,
    addressId,
  } = req.body;

  if (amount == null || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({
      error:
        'Parâmetro "amount" inválido ou ausente. Deve ser um número positivo representando o valor na unidade principal (ex: 50.00 para R$50,00).',
    });
    return;
  }
  if (!currency || typeof currency !== "string" || currency.length !== 3) {
    res.status(400).json({
      error:
        'Parâmetro "currency" inválido ou ausente. Deve ser um código ISO de 3 letras (ex: "brl").',
    });
    return;
  }
  if (!professionalId || !selectedTime || !serviceId || !addressId) {
    res.status(400).json({
      error:
        "Dados do agendamento (professionalId, selectedTime, serviceId, addressId) são obrigatórios.",
    });
    return;
  }

  const amountInCents = Math.round(amount * 100);

  const metadata = {
    professionalId: professionalId.toString(),
    serviceId: serviceId.toString(),
    selectedTime: selectedTime,
    addressId: addressId.toString(),
  };

  try {
    const clientSecret = await PaymentService.createPaymentIntent({
      amount: amountInCents,        // ✅ CORREÇÃO AQUI
      currency: currency.toLowerCase(),
      metadata: metadata,
    });
    res.status(200).json({ clientSecret });
  } catch (error: any) {
    console.error(
      "[PaymentController] Erro ao criar Payment Intent:",
      error.message
    );
    res.status(500).json({
      error: "Falha ao processar o pagamento. Por favor, tente novamente.",
    });
  }
};

export const confirmPaymentController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { paymentIntentId, userId } = req.body;

  if (!paymentIntentId) {
    res
      .status(400)
      .json({ error: "O ID do pagamento (paymentIntentId) é obrigatório." });
    return;
  }
  if (!userId) {
    res.status(401).json({
      error: "ID do usuário (userId) é obrigatório no corpo da requisição.",
    });
    return;
  }

  const authenticatedUserId = Number(userId);

  try {
    const newAppointment = await PaymentService.confirmAndCreateAppointment(
      paymentIntentId,
      authenticatedUserId
    );
    res.status(201).json({
      message: "Agendamento criado com sucesso!",
      appointment: newAppointment,
    });
  } catch (error: any) {
    console.error(
      `[PaymentController] Erro ao confirmar pagamento ${paymentIntentId}:`,
      error.message
    );
    res
      .status(500)
      .json({ error: error.message || "Falha ao confirmar o agendamento." });
  }
};
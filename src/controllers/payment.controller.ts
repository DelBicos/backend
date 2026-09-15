import { Request, Response } from "express";
import { PaymentService } from "../services/payment.service"; // Importa o serviço testado
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

export const createPaymentIntentController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // 1. Extrair 'amount' e 'currency' do corpo da requisição
  const {
    amount,
    currency,
    professionalId,
    selectedTime,
    serviceId,
    addressId,
    appointmentId,
  } = req.body;

  // 2. Validação dos dados de entrada
  if (amount == null || typeof amount !== "number" || amount <= 0) {
    // Retorna erro 400 se o 'amount' for inválido
    res.status(400).json({
      error:
        'Parâmetro "amount" inválido ou ausente. Deve ser um número positivo representando o valor na unidade principal (ex: 50.00 para R$50,00).',
    });
    return;
  }
  if (!currency || typeof currency !== "string" || currency.length !== 3) {
    // Retorna erro 400 se a 'currency' for inválida
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

  // (Opcional: Obter o ID do cliente a partir do middleware de autenticação)
  // const clientId = (req as any).user?.id;
  // if (!clientId) {
  //   res.status(401).json({ error: 'Usuário não autenticado.' });
  //   return;
  // }

  // 3. Converter 'amount' para a menor unidade monetária (centavos)
  // Certifique-se de que a lógica de arredondamento está correta para evitar problemas com floats.
  const amountInCents = Math.round(amount * 100);

  // Opcional: Extrair metadados (ex: ID do pedido, ID do usuário) do corpo ou do usuário autenticado
  const metadata = {
    // clientId: clientId.toString(), // Salva quem está comprando
    professionalId: professionalId.toString(),
    serviceId: serviceId.toString(),
    selectedTime: selectedTime, // Já deve ser uma string (data ISO ou similar)
    addressId: addressId.toString(),
    ...(appointmentId ? { appointmentId: appointmentId.toString() } : {}),
  };

  try {
    // 4. Chamar o serviço com os dados processados
    const clientSecret = await PaymentService.createPaymentIntent({
      amount: amountInCents,
      currency: currency.toLowerCase(), // Garante minúsculas
      metadata: metadata, // Passa os metadados
    });

    // 5. Enviar a resposta de sucesso com o clientSecret
    res.status(200).json({ clientSecret });
  } catch (error: any) {
    // 6. Capturar erros vindos do serviço (incluindo erros do Stripe)
    console.error(
      "[PaymentController] Erro ao criar Payment Intent:",
      error.message
    );
    // Retorna um erro 500 genérico para o frontend, escondendo detalhes internos
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

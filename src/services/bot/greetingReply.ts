import type {
  BotSessionContext,
  BotSessionState,
} from "../../models/BotChatSession";

/**
 * Responde a uma saudação sem perder uma conversa que já esteja em andamento.
 * A segunda frase retoma somente a informação esperada no estado atual.
 */
export function buildGreetingReply(
  state: BotSessionState,
  context: BotSessionContext,
): string {
  const greeting = "Olá! 👋 Sou o assistente virtual do DelBicos.";

  switch (state) {
    case "COLETANDO_SERVICO":
      if (context.pendingService) {
        return `${greeting}\n\nVocê quer confirmar o serviço "${context.pendingService.title}"? Responda com sim ou não.`;
      }
      if (context.serviceChoicesData?.length || context.serviceOptionsData?.length) {
        return `${greeting}\n\nVamos continuar seu agendamento. Escolha uma das opções de serviço exibidas.`;
      }
      return `${greeting}\n\nVamos continuar seu agendamento. Qual serviço você precisa?`;

    case "SELECIONANDO_PROFISSIONAL":
      return `${greeting}\n\nJá temos o serviço, o dia e o horário. Agora escolha um dos profissionais disponíveis.`;

    case "COLETANDO_DATA":
      return `${greeting}\n\nVamos continuar o agendamento${context.serviceName ? ` de "${context.serviceName}"` : ""}. Qual dia você prefere?`;

    case "COLETANDO_HORARIO":
    case "VERIFICANDO_DISPONIBILIDADE":
      if (context.suggestedSlotsData?.length) {
        return `${greeting}\n\nJá temos o dia e o horário. Agora escolha um dos profissionais disponíveis.`;
      }
      return `${greeting}\n\nVamos continuar seu agendamento. Qual horário você prefere?`;

    case "CONFIRMACAO":
      return `${greeting}\n\nO agendamento está pronto para confirmação. Responda com sim para confirmar ou não para cancelar.`;

    case "AGUARDANDO_ID_AGENDAMENTO":
      return `${greeting}\n\nPara continuar, informe o ID do agendamento.`;

    case "AGUARDANDO_CONFIRMACAO":
      return `${greeting}\n\nSeu pedido já foi enviado e está aguardando a resposta do profissional.`;

    default:
      return (
        `${greeting}\n\nPosso ajudar a agendar um serviço, consultar seus agendamentos, ` +
        "cancelar ou reagendar. O que você gostaria de fazer?"
      );
  }
}

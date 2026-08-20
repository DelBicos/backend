import { BotSessionContext, BotSessionState } from "../models/BotChatSession";
import { analyzeMessage, isRestartCommand } from "./nlu.service";
import { BotSessionManager } from "./bot/BotSessionManager";
import { BotMessageRouter } from "./bot/BotMessageRouter";
import { BotState } from "../constants/botStates";
import { logError } from "../utils/logger";
import { resolveBotTimeZone } from "../utils/date.util";
import { buildGreetingReply } from "./bot/greetingReply";
import { normalizeText } from "../utils/nlp.util";

export interface BotMessageResponse {
  sessionId: number;
  message: string;
  state: BotSessionState;
  context: BotSessionContext;
  clearHistory?: boolean;
}

export interface BotSessionHistory {
  session: {
    id: number;
    state: BotSessionState;
    status: string;
    channel: string;
    context: BotSessionContext;
    started_at: Date;
    ended_at: Date | null;
    appointment_id: number | null;
    appointment_status: "pending" | "confirmed" | "completed" | "canceled" | null;
    appointment_paid: boolean;
    payment_pending: boolean;
    waiting_for_professional: boolean;
    poll_after_ms: number | null;
  };
  messages: Array<{
    id: number;
    sender: "user" | "bot";
    content: string;
    intent: string | null;
    entities: Record<string, unknown> | null;
    createdAt: Date;
  }>;
}

export async function processMessage(
  userId: number,
  authSessionId: string | undefined,
  userMessage: string,
  sessionId?: number,
  channel = "web",
  selectedTimeIso?: string,
  timeZone?: string,
): Promise<BotMessageResponse> {
  // 1. Carregar ou criar sessão
  let session = await BotSessionManager.getOrCreateSession(userId, authSessionId, channel, sessionId);

  const trimmedMessage = userMessage.trim().slice(0, 2000);
  const lowerMsg = trimmedMessage.toLowerCase().trim();

  // A. Recomeçar/Reiniciar fluxo globalmente
  if (isRestartCommand(lowerMsg) || /^(?:outro\s+servi[cç]o|nova\s+solicita[cç][aã]o)$/i.test(lowerMsg)) {
    session = await BotSessionManager.restartSession(session, authSessionId);
    const replyText = "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?";
    await BotSessionManager.createMessage(session.id, "bot", replyText);

    return {
      sessionId: session.id,
      message: replyText,
      state: BotState.INICIO,
      context: {},
      clearHistory: true,
    };
  }

  const ctx = (session.context ?? {}) as BotSessionContext;
  ctx.timeZone = resolveBotTimeZone(timeZone ?? ctx.timeZone);

  // B. Escolher outro profissional
  if (/^(outro\s+profissional|mudar\s+de\s+profissional|outro\s+prestador)$/i.test(lowerMsg)) {
    if (ctx.serviceName) {
      const nluFake = { intent: "AGENDAR" as const, entities: { service: ctx.serviceName }, confidence: 1.0 };
      
      // Roteia diretamente para o estado COLETANDO_SERVICO
      const result = await BotMessageRouter.route(
        BotState.COLETANDO_SERVICO,
        ctx.serviceName,
        nluFake,
        session,
        userId,
        selectedTimeIso
      );
      
      const mergedContext = {
        ...(session.context ?? {}),
        ...result.contextUpdate,
        professionalId: undefined,
        professionalName: undefined,
        date: undefined,
        time: undefined,
        newDate: undefined,
        newTime: undefined,
        suggestedDates: undefined,
        suggestedSlots: undefined,
      };

      const replyText =
        "Entendido. Vamos procurar outro profissional para esse serviço.\n\n" +
        result.reply;
      await BotSessionManager.saveSession(session, result.nextState, mergedContext);
      await BotSessionManager.createMessage(session.id, "bot", replyText);

      return {
        sessionId: session.id,
        message: replyText,
        state: session.state,
        context: session.context as BotSessionContext,
      };
    } else {
      await BotSessionManager.saveSession(session, BotState.INICIO, {});
      const replyText = "Você ainda não escolheu um serviço. Vamos recomeçar — qual tipo de serviço você precisa?";
      await BotSessionManager.createMessage(session.id, "bot", replyText);
      return {
        sessionId: session.id,
        message: replyText,
        state: BotState.INICIO,
        context: {},
      };
    }
  }

  // 2. Entradas estruturadas (sim/não, número, data e hora) são tratadas por
  // regras dentro de analyzeMessage. As demais podem interromper o fluxo atual
  // por uma intenção explícita, mesmo durante um agendamento pendente.
  const nlu = await analyzeMessage(trimmedMessage, ctx as Record<string, unknown>);

  // Persiste mensagem do usuário
  await BotSessionManager.createMessage(session.id, "user", trimmedMessage, nlu.intent, {
    ...nlu.entities,
    input_channel: channel,
  });

  // Saudações são globais: elas nunca devem ser interpretadas como nome de
  // serviço nem apagar um agendamento parcialmente preenchido.
  if (nlu.intent === "SAUDACAO") {
    const replyText = buildGreetingReply(session.state, ctx);
    await BotSessionManager.saveSession(session, session.state, ctx);
    await BotSessionManager.createMessage(session.id, "bot", replyText);

    return {
      sessionId: session.id,
      message: replyText,
      state: session.state,
      context: ctx,
    };
  }

  // 3. Verifica redirecionamento explícito
  const isExplicitIntent = ["AGENDAR", "ALTERAR", "CANCELAR", "CONSULTAR"].includes(nlu.intent);
  let shouldRedirectToInicio = false;
  if (isExplicitIntent) {
    if (nlu.intent === "AGENDAR") {
      const schedulingStates: BotSessionState[] = [
        BotState.COLETANDO_SERVICO,
        BotState.COLETANDO_DATA,
        BotState.COLETANDO_HORARIO,
        BotState.SELECIONANDO_PROFISSIONAL,
        BotState.CONFIRMACAO,
      ];
      const isContinuingCurrentBooking =
        ctx.pendingAction === "CREATE" && schedulingStates.includes(session.state);
      const requestedService = nlu.entities.service
        ? normalizeText(nlu.entities.service)
        : "";
      const currentService = ctx.serviceName ? normalizeText(ctx.serviceName) : "";
      const requestsDifferentService =
        requestedService.length > 0 &&
        (currentService.length === 0 ||
          (!currentService.includes(requestedService) &&
            !requestedService.includes(currentService)));
      shouldRedirectToInicio =
        !isContinuingCurrentBooking || requestsDifferentService;
    } else {
      // Cancelar, alterar ou consultar representam uma nova ação explícita;
      // portanto também interrompem confirmações e pedidos de ID anteriores.
      shouldRedirectToInicio = true;
    }
  }

  if (shouldRedirectToInicio) {
    session.state = BotState.INICIO;
    session.context = {};
    // Um novo pedido não deve manter o vínculo com o agendamento que estava
    // sendo acompanhado antes da mudança de intenção.
    session.appointment_id = null;
  }

  // 4. Roteia para o handler correspondente
  let result;
  try {
    result = await BotMessageRouter.route(
      session.state as BotState,
      trimmedMessage,
      nlu,
      session,
      userId,
      selectedTimeIso
    );
  } catch (error: any) {
    logError("Bot: erro inesperado no roteamento de mensagem", error, {
      userId,
      sessionId: session.id,
      state: session.state,
    });
    result = {
      reply: "Desculpe, ocorreu um erro inesperado. Por favor, tente novamente.",
      nextState: session.state,
      contextUpdate: {},
    };
  }

  // 5. Salva resposta do bot no histórico
  await BotSessionManager.createMessage(session.id, "bot", result.reply);

  // 6. Atualiza contexto e estado final
  const mergedContext: BotSessionContext = {
    ...(session.context ?? {}),
    ...result.contextUpdate,
    timeZone: ctx.timeZone,
  };

  let finalState = result.nextState;
  let finalStatus = session.status;
  let finalEndedAt = session.ended_at;

  if (result.appointmentId) {
    mergedContext.appointmentId = result.appointmentId;
  }
  if (result.finalize) {
    finalStatus = "completed";
    finalEndedAt = new Date();
  }

  // Se finalizou e transicionou para INICIO na mesma rota, cuida do encerramento e inicializa nova sessão
  if (result.nextState === BotState.FINALIZADO || (result.finalize && result.nextState === BotState.INICIO)) {
    session.status = "completed";
    session.ended_at = new Date();
    await session.save();

    const newSession = await BotSessionManager.getOrCreateSession(userId, authSessionId, session.channel);
    await BotSessionManager.createMessage(newSession.id, "bot", result.reply);

    return {
      sessionId: newSession.id,
      message: result.reply,
      state: BotState.INICIO,
      context: {},
    };
  }

  session.status = finalStatus;
  session.ended_at = finalEndedAt;
  await BotSessionManager.saveSession(session, finalState, mergedContext, result.appointmentId);

  return {
    sessionId: session.id,
    message: result.reply,
    state: finalState,
    context: mergedContext,
  };
}

export async function getSessionHistory(
  sessionId: number,
  userId: number,
): Promise<BotSessionHistory> {
  const history = await BotSessionManager.getHistoryBySessionId(sessionId, userId);
  if (!history) {
    throw new Error("Histórico de sessão não encontrado ou não pertence a este usuário");
  }
  return history;
}

/** Returns the latest conversation owned by the authenticated user. */
export async function getActiveSessionHistory(
  userId: number,
): Promise<BotSessionHistory | null> {
  return BotSessionManager.getHistory(userId);
}

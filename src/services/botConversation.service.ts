import { BotSessionContext, BotSessionState } from "../models/BotChatSession";
import { analyzeMessage, NluEntities } from "./nlu.service";
import { parsePortugueseDate, parseTimeFromText } from "../utils/date.util";
import { BotSessionManager } from "./bot/BotSessionManager";
import { BotMessageRouter } from "./bot/BotMessageRouter";
import { BotState } from "../constants/botStates";
import { logError } from "../utils/logger";

export interface BotMessageResponse {
  sessionId: number;
  message: string;
  state: BotSessionState;
  context: BotSessionContext;
}

export interface BotSessionHistory {
  session: {
    id: number;
    state: BotSessionState;
    status: string;
    channel: string;
    started_at: Date;
    ended_at: Date | null;
    appointment_id: number | null;
  };
  messages: Array<{
    id: number;
    sender: "user" | "bot";
    content: string;
    intent: string | null;
    createdAt: Date;
  }>;
}

export async function processMessage(
  userId: number,
  authSessionId: string,
  userMessage: string,
  sessionId?: number,
  channel = "web",
  selectedTimeIso?: string,
): Promise<BotMessageResponse> {
  // 1. Carregar ou criar sessão
  let session = await BotSessionManager.getOrCreateSession(userId, authSessionId, channel, sessionId);

  const trimmedMessage = userMessage.trim().slice(0, 2000);
  const lowerMsg = trimmedMessage.toLowerCase().trim();

  // A. Recomeçar/Reiniciar fluxo globalmente
  if (/^(recome[cç]ar|reiniciar|come[cç]ar\s+de\s+novo|limpar\s+chat|outro\s+servi[cç]o)$/i.test(lowerMsg)) {
    await BotSessionManager.saveSession(session, BotState.INICIO, {}, null);
    const replyText = "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?";
    await BotSessionManager.createMessage(session.id, "bot", replyText);

    return {
      sessionId: session.id,
      message: replyText,
      state: BotState.INICIO,
      context: {},
    };
  }

  const ctx = (session.context ?? {}) as BotSessionContext;

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

      const replyText = `Entendido. Vamos escolher outro profissional. Aqui estão os profissionais disponíveis:\n\n${result.reply}`;
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

  // 2. Decisão dinâmica de acionar NLU (Gemini)
  let needNlu = true;
  if (session.state === BotState.CONFIRMACAO || session.state === BotState.VERIFICANDO_DISPONIBILIDADE) {
    needNlu = false;
  } else if (session.state === BotState.COLETANDO_DATA) {
    const choice = parseInt(lowerMsg, 10);
    const isValidChoice = ctx.suggestedDates && !isNaN(choice) && choice >= 1 && choice <= ctx.suggestedDates.length;
    const isValidLocalDate = parsePortugueseDate(trimmedMessage) !== null;
    if (isValidChoice || isValidLocalDate) {
      needNlu = false;
    }
  } else if (session.state === BotState.COLETANDO_HORARIO) {
    const choice = parseInt(lowerMsg, 10);
    const isValidChoice = ctx.suggestedSlots && !isNaN(choice) && choice >= 1 && choice <= ctx.suggestedSlots.length;
    const isValidLocalTime = parseTimeFromText(trimmedMessage) !== null;
    if (isValidChoice || isValidLocalTime) {
      needNlu = false;
    }
  }

  const nlu = needNlu
    ? await analyzeMessage(trimmedMessage, ctx as Record<string, unknown>)
    : { intent: "FALLBACK" as const, entities: {} as NluEntities, confidence: 1.0 };

  // Persiste mensagem do usuário
  await BotSessionManager.createMessage(session.id, "user", trimmedMessage, nlu.intent, nlu.entities as Record<string, unknown>);

  // 3. Verifica redirecionamento explícito
  const isExplicitIntent = ["AGENDAR", "ALTERAR", "CANCELAR", "CONSULTAR"].includes(nlu.intent);
  let shouldRedirectToInicio = false;
  if (isExplicitIntent) {
    if (nlu.intent === "AGENDAR") {
      if (!nlu.entities.service || session.state !== BotState.COLETANDO_SERVICO || ctx.pendingService) {
        shouldRedirectToInicio = true;
      }
    } else {
      if (session.state !== BotState.CONFIRMACAO && session.state !== BotState.AGUARDANDO_ID_AGENDAMENTO) {
        shouldRedirectToInicio = true;
      }
    }
  }

  if (shouldRedirectToInicio) {
    session.state = BotState.INICIO;
    session.context = {};
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
  authSessionId: string,
): Promise<BotSessionHistory> {
  const history = await BotSessionManager.getHistory(userId, authSessionId);
  if (!history || history.session.id !== sessionId) {
    throw new Error("Histórico de sessão não encontrado ou não pertence a este usuário");
  }
  return history;
}

/** Returns the pending conversation for the current JWT login, if any. */
export async function getActiveSessionHistory(
  userId: number,
  authSessionId: string,
): Promise<BotSessionHistory | null> {
  return BotSessionManager.getHistory(userId, authSessionId);
}

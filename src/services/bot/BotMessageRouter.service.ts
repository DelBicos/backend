import { BotState } from "../../constants/botStates";
import { BotChatSessionModel } from "../../models/BotChatSession";
import { isSchedulingActionWord, NluResult } from "../nlu.service";
import { BotStateNode, HandlerResult } from "./BotStateNode";
import { InicioState } from "./states/InicioState.service";
import { ColetandoServicoState } from "./states/ColetandoServicoState";
import { ColetandoDataState } from "./states/ColetandoDataState";
import { ColetandoHorarioState } from "./states/ColetandoHorarioState.service";
import { ConfirmacaoState } from "./states/ConfirmacaoState.service";
import { AguardandoIdAgendamentoState } from "./states/AguardandoIdAgendamentoState.service";
import { AguardandoConfirmacaoState } from "./states/AguardandoConfirmacaoState";
import { SelecionandoProfissionalState } from "./states/SelecionandoProfissionalState";
import { normalizeText } from "../../utils/nlp.util";
import { requestBookingAddress } from "./states/bookingDetails.service";
import { buildConfirmationResponse } from "./states/stateHelpers.rules";
import { parseReschedulePreservation } from "./rescheduleInput.rules";

const stateNodes: Record<BotState, BotStateNode> = {
  [BotState.INICIO]: new InicioState(),
  [BotState.COLETANDO_SERVICO]: new ColetandoServicoState(),
  [BotState.SELECIONANDO_PROFISSIONAL]: new SelecionandoProfissionalState(),
  [BotState.COLETANDO_DATA]: new ColetandoDataState(),
  [BotState.COLETANDO_HORARIO]: new ColetandoHorarioState(),
  [BotState.VERIFICANDO_DISPONIBILIDADE]: new ColetandoHorarioState(), // Roteia para horário
  [BotState.CONFIRMACAO]: new ConfirmacaoState(),
  [BotState.COLETANDO_ENDERECO]: new ConfirmacaoState(),
  [BotState.AGUARDANDO_CONFIRMACAO]: new AguardandoConfirmacaoState(),
  [BotState.AGUARDANDO_ID_AGENDAMENTO]: new AguardandoIdAgendamentoState(),
  [BotState.FINALIZADO]: new InicioState(),
};

function isGenericSchedulingCommand(message: string): boolean {
  const normalized = normalizeText(message).replace(
    /^(?:(?:oi|ola)|bom\s+dia|boa\s+(?:tarde|noite))\s+/,
    "",
  );
  const conversationalWords = new Set([
    "a",
    "abrir",
    "atendimento",
    "como",
    "criar",
    "da",
    "de",
    "desejo",
    "dia",
    "eu",
    "fazer",
    "favor",
    "gentileza",
    "gostaria",
    "iniciar",
    "me",
    "nova",
    "novo",
    "pode",
    "podem",
    "por",
    "porfavor",
    "pra",
    "preciso",
    "pretendo",
    "profissional",
    "queria",
    "quero",
    "servico",
    "tem",
    "um",
    "uma",
    "vamos",
  ]);
  const meaningfulWords = normalized
    .split(" ")
    .filter(Boolean)
    .filter((word) => !conversationalWords.has(word));

  return (
    meaningfulWords.length === 1 && isSchedulingActionWord(meaningfulWords[0])
  );
}

function hasServiceRequestCue(message: string): boolean {
  return /\b(?:quero|queria|preciso|gostaria|desejo|necessito|procuro|busco)\b/.test(
    normalizeText(message),
  );
}

function looksLikeServiceDescription(message: string): boolean {
  const normalized = normalizeText(message);
  if (
    /^(?:obrigad[oa]?|valeu|vlw|tudo\s+bem|como\s+voce\s+esta|quem\s+e\s+voce|ajuda|socorro|sim|nao|ok)$/.test(
      normalized,
    )
  ) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);
  return (
    words.length > 0 &&
    /\b(?:troca|trocar|conserto|consertar|manutencao|instalacao|instalar|limpeza|limpar|reforma|reformar|montagem|montar|servico|profissional)\b/.test(
      normalized,
    )
  );
}

export class BotMessageRouter {
  /**
   * Roteia a mensagem para o handler correspondente e executa transições encadeadas, se houver.
   */
  public static async route(
    state: BotState,
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
    selectedTimeIso?: string,
  ): Promise<HandlerResult> {
    const handler = stateNodes[state];
    if (!handler) {
      throw new Error(`Nenhum handler registrado para o estado: ${state}`);
    }

    const preservation = parseReschedulePreservation(userMessage, state, session.context ?? {});
    nlu = { ...nlu, entities: {
      ...nlu.entities,
      ...(preservation.keepDate && !nlu.entities.date ? { date: session.context?.date } : {}),
      ...(!nlu.entities.time && preservation.keepTime ? { time: session.context?.time } : {}),
      ...(!nlu.entities.time && !preservation.keepTime && state === BotState.COLETANDO_DATA &&
        session.context?.pendingAction === "RESCHEDULE" && !session.context.newDate && session.context.newTime
        ? { time: session.context.newTime } : {}),
    } };
    let result = await handler.handle(
      userMessage,
      nlu,
      session,
      userId,
      selectedTimeIso,
    );

    // Na primeira mensagem, consulta o catálogo tanto para serviço isolado
    // (NLU FALLBACK) quanto para AGENDAR sem entidade. A busca informa se houve
    // correspondência forte; conversa casual continua com a resposta de INICIO.
    if (state === BotState.INICIO) {
      const explicitService = nlu.entities.service?.trim();
      const shouldProbeFallback = nlu.intent === "FALLBACK";
      const shouldProbeSchedulingDescription =
        nlu.intent === "AGENDAR" &&
        !explicitService &&
        !isGenericSchedulingCommand(userMessage);
      const searchTerm =
        explicitService ??
        (shouldProbeFallback || shouldProbeSchedulingDescription
          ? userMessage.trim()
          : "");

      if (searchTerm) {
        const originalContext = session.context;
        session.context = {
          timeZone: originalContext?.timeZone,
          intent: "AGENDAR",
          pendingAction: "CREATE",
        };

        const serviceResult = await stateNodes[
          BotState.COLETANDO_SERVICO
        ].handle(searchTerm, nlu, session, userId, selectedTimeIso);
        const acceptsResult =
          serviceResult.serviceSearchOutcome === "MATCHED" ||
          serviceResult.serviceSearchOutcome === "UNAVAILABLE" ||
          (serviceResult.serviceSearchOutcome === "NOT_FOUND" &&
            (Boolean(explicitService) ||
              shouldProbeSchedulingDescription ||
              hasServiceRequestCue(userMessage) ||
              looksLikeServiceDescription(userMessage)));

        if (acceptsResult) {
          result = serviceResult;
        } else {
          session.context = originalContext;
        }
      }
    }

    // Após resolver o ID, os valores originais ficam disponíveis também para
    // pedidos completos como "alterar #ABC para dia 30 mantendo o horário".
    const rescheduleContext = { ...session.context, ...result.contextUpdate };
    const requestedPreservation = parseReschedulePreservation(userMessage, state, rescheduleContext);
    nlu = { ...nlu, entities: {
      ...nlu.entities,
      ...(requestedPreservation.keepDate && !nlu.entities.date ? { date: rescheduleContext.date } : {}),
      ...(requestedPreservation.keepTime && !nlu.entities.time ? { time: rescheduleContext.time } : {}),
    } };
    if (requestedPreservation.keepTime && result.nextState === BotState.COLETANDO_DATA && !nlu.entities.date) {
      result.contextUpdate.newTime = nlu.entities.time;
    }

    // Uma única fala costuma trazer mais de uma etapa do agendamento, por
    // exemplo: "quero limpeza sexta às 14:30". O NLU já extrai essas
    // entidades, mas antes o roteador descartava data e horário assim que o
    // serviço era localizado e obrigava o usuário a repeti-los. Avança apenas
    // pelas etapas que possuem uma entidade explícita, mantendo as validações
    // de disponibilidade dos mesmos handlers usados em mensagens separadas.
    if (result.nextState === BotState.COLETANDO_DATA && nlu.entities.date) {
      session.context = {
        ...(session.context ?? {}),
        ...result.contextUpdate,
      };
      result = await stateNodes[BotState.COLETANDO_DATA].handle(
        userMessage,
        nlu,
        session,
        userId,
        selectedTimeIso,
      );
    }

    if (
      result.nextState === BotState.COLETANDO_HORARIO &&
      (nlu.entities.time || nlu.entities.time_period)
    ) {
      session.context = {
        ...(session.context ?? {}),
        ...result.contextUpdate,
      };
      result = await stateNodes[BotState.COLETANDO_HORARIO].handle(
        userMessage,
        nlu,
        session,
        userId,
        selectedTimeIso,
      );
    }

    // A escolha do profissional inicia a coleta restante, nunca cria a reserva.
    // A confirmação final só é mostrada depois da escolha do endereço.
    const context = { ...(session.context ?? {}), ...result.contextUpdate };
    if (result.nextState === BotState.CONFIRMACAO &&
        (context.pendingAction ?? "CREATE") === "CREATE" &&
        context.bookingDetailsStep === "REVIEW" &&
        state !== BotState.CONFIRMACAO) {
      const confirmation = buildConfirmationResponse(
        context,
        context.date ?? "",
        context.time ?? "",
        context,
      );
      return {
        ...confirmation,
        reply: buildConfirmationResponse(
          context,
          context.date ?? "",
          context.time ?? "",
          confirmation.contextUpdate,
        ).reply,
        contextUpdate: { ...context, ...confirmation.contextUpdate },
      };
    }
    if (result.nextState === BotState.CONFIRMACAO &&
        (context.pendingAction ?? "CREATE") === "CREATE" &&
        context.bookingDetailsStep !== "REVIEW") {
      const addressPrompt = await requestBookingAddress(userId);
      return {
        ...addressPrompt,
        contextUpdate: { ...result.contextUpdate, ...addressPrompt.contextUpdate },
      };
    }
    return result;
  }
}

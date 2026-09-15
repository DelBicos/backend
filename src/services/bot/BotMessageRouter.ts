import { BotState } from "../../constants/botStates";
import { BotChatSessionModel } from "../../models/BotChatSession";
import { isSchedulingActionWord, NluResult } from "../nlu.service";
import { BotStateNode, HandlerResult } from "./BotStateNode";
import { InicioState } from "./states/InicioState";
import { ColetandoServicoState } from "./states/ColetandoServicoState";
import { ColetandoDataState } from "./states/ColetandoDataState";
import { ColetandoHorarioState } from "./states/ColetandoHorarioState";
import { ConfirmacaoState } from "./states/ConfirmacaoState";
import { AguardandoIdAgendamentoState } from "./states/AguardandoIdAgendamentoState";
import { AguardandoConfirmacaoState } from "./states/AguardandoConfirmacaoState";
import { SelecionandoProfissionalState } from "./states/SelecionandoProfissionalState";
import { normalizeText } from "../../utils/nlp.util";

const stateNodes: Record<BotState, BotStateNode> = {
  [BotState.INICIO]: new InicioState(),
  [BotState.COLETANDO_SERVICO]: new ColetandoServicoState(),
  [BotState.SELECIONANDO_PROFISSIONAL]: new SelecionandoProfissionalState(),
  [BotState.COLETANDO_DATA]: new ColetandoDataState(),
  [BotState.COLETANDO_HORARIO]: new ColetandoHorarioState(),
  [BotState.VERIFICANDO_DISPONIBILIDADE]: new ColetandoHorarioState(), // Roteia para horário
  [BotState.CONFIRMACAO]: new ConfirmacaoState(),
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
    (words.length <= 5 ||
      /\b(?:troca|trocar|conserto|consertar|manutencao|instalacao|instalar|limpeza|limpar|reforma|reformar|montagem|montar|servico|profissional)\b/.test(
        normalized,
      ))
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

    return result;
  }
}

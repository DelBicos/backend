import { BotState } from "../../constants/botStates";
import { BotChatSessionModel } from "../../models/BotChatSession";
import { NluResult } from "../nlu.service";
import { BotStateNode, HandlerResult } from "./BotStateNode";
import { InicioState } from "./states/InicioState";
import { ColetandoServicoState } from "./states/ColetandoServicoState";
import { ColetandoDataState } from "./states/ColetandoDataState";
import { ColetandoHorarioState } from "./states/ColetandoHorarioState";
import { ConfirmacaoState } from "./states/ConfirmacaoState";
import { AguardandoIdAgendamentoState } from "./states/AguardandoIdAgendamentoState";
import { AguardandoConfirmacaoState } from "./states/AguardandoConfirmacaoState";

const stateNodes: Record<BotState, BotStateNode> = {
  [BotState.INICIO]: new InicioState(),
  [BotState.COLETANDO_SERVICO]: new ColetandoServicoState(),
  [BotState.SELECIONANDO_PROFISSIONAL]: new ColetandoServicoState(),
  [BotState.COLETANDO_DATA]: new ColetandoDataState(),
  [BotState.COLETANDO_HORARIO]: new ColetandoHorarioState(),
  [BotState.VERIFICANDO_DISPONIBILIDADE]: new ColetandoHorarioState(), // Roteia para horário
  [BotState.CONFIRMACAO]: new ConfirmacaoState(),
  [BotState.AGUARDANDO_CONFIRMACAO]: new AguardandoConfirmacaoState(),
  [BotState.AGUARDANDO_ID_AGENDAMENTO]: new AguardandoIdAgendamentoState(),
  [BotState.FINALIZADO]: new InicioState(),
};

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

    let result = await handler.handle(userMessage, nlu, session, userId, selectedTimeIso);

    // Double transition 1: INICIO -> COLETANDO_SERVICO com serviço detectado via NLU
    if (state === BotState.INICIO && result.nextState === BotState.COLETANDO_SERVICO && nlu.entities.service) {
      session.context = {
        ...(session.context ?? {}),
        ...result.contextUpdate,
      };
      const servHandler = stateNodes[BotState.COLETANDO_SERVICO];
      result = await servHandler.handle(nlu.entities.service, nlu, session, userId, selectedTimeIso);
    }

    // Double transition 2: COLETANDO_SERVICO -> Re-processa se o NLU detectou nova intenção de agendar serviço
    if (state === BotState.COLETANDO_SERVICO && result.nextState === BotState.COLETANDO_SERVICO && nlu.intent === "AGENDAR" && nlu.entities.service) {
      const servHandler = stateNodes[BotState.COLETANDO_SERVICO];
      result = await servHandler.handle(nlu.entities.service, nlu, session, userId, selectedTimeIso);
    }

    return result;
  }
}

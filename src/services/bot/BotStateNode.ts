import { BotSessionContext, BotSessionState, BotChatSessionModel } from "../../models/BotChatSession";
import { NluResult } from "../nlu.service";

export interface HandlerResult {
  reply: string;
  nextState: BotSessionState;
  contextUpdate: Partial<BotSessionContext>;
  appointmentId?: number;
  finalize?: boolean;
}

export interface BotStateNode {
  handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
    selectedTimeIso?: string,
  ): Promise<HandlerResult>;
}

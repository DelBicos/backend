import {
  BotChatSessionModel,
  BotProfessionalOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { normalizeText } from "../../../utils/nlp.util";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { buildConfirmationResponse } from "./stateHelpers";

function findProfessional(
  message: string,
  options: BotProfessionalOption[],
): BotProfessionalOption | null {
  const choice = parseInt(message.trim(), 10);
  if (!isNaN(choice)) {
    return options.find((option) => option.index === choice) ?? null;
  }

  const normalizedMessage = normalizeText(message);
  if (normalizedMessage.length < 2) return null;

  return (
    options.find((option) => {
      const name = normalizeText(option.professionalName);
      return (
        name === normalizedMessage ||
        name.includes(normalizedMessage) ||
        normalizedMessage.includes(name)
      );
    }) ?? null
  );
}

function confirmsCurrentOption(message: string): boolean {
  const normalized = normalizeText(message).trim();
  return /^(?:sim|s|confirmar|confirmo|confirmado|ok|pode|pode ser|vamos|fechado|combinado|aceito)$/.test(
    normalized,
  );
}

export class SelecionandoProfissionalState implements BotStateNode {
  public async handle(
    userMessage: string,
    _nlu: NluResult,
    session: BotChatSessionModel,
    _userId: number,
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const options = ctx.professionalOptionsData ?? [];

    if (options.length === 0) {
      return {
        reply:
          "As opções de profissionais expiraram. Informe novamente o horário desejado para eu atualizar a disponibilidade.",
        nextState: "COLETANDO_HORARIO",
        contextUpdate: {
          professionalOptionsData: undefined,
        },
      };
    }

    const confirmsOption = confirmsCurrentOption(userMessage);
    const picked =
      confirmsOption && options.length === 1
        ? options[0]
        : findProfessional(userMessage, options);
    if (!picked) {
      return {
        reply:
          (confirmsOption && options.length > 1
            ? "Há mais de um profissional disponível. Escolha um pelo número ou pelo nome:\n\n"
            : "Não identifiquei esse profissional. Escolha uma opção pelo número ou pelo nome:\n\n") +
          options
            .map((option) => `${option.index}. ${option.professionalName}`)
            .join("\n"),
        nextState: "SELECIONANDO_PROFISSIONAL",
        contextUpdate: {},
      };
    }

    const isAlterar = ctx.pendingAction === "RESCHEDULE";
    const date = isAlterar ? (ctx.newDate ?? ctx.date) : ctx.date;
    const time = picked.time;
    if (!date) {
      return {
        reply:
          "Antes de escolher o profissional, preciso saber o dia. Qual data você prefere?",
        nextState: "COLETANDO_DATA",
        contextUpdate: {
          professionalOptionsData: undefined,
        },
      };
    }

    const timeField = isAlterar ? "newTime" : "time";
    const contextUpdate: Partial<BotSessionContext> = {
      [timeField]: time,
      serviceId: picked.serviceId,
      professionalId: picked.professionalId,
      professionalName: picked.professionalName,
      professionalAvatarUri: picked.professionalAvatarUri,
      professionalRating: picked.professionalRating,
      professionalRatingsCount: picked.professionalRatingsCount,
      professionalCity: picked.professionalCity,
      professionalState: picked.professionalState,
      servicePrice: picked.price,
      serviceDuration: picked.duration,
      professionalOptionsData: undefined,
    };

    return buildConfirmationResponse(
      { ...ctx, ...contextUpdate },
      date,
      time,
      contextUpdate,
    );
  }
}

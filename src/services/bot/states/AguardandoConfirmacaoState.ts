import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import {
  BotChatSessionModel,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";

/** Keeps the conversation open while the professional reviews the request. */
export class AguardandoConfirmacaoState implements BotStateNode {
  public async handle(
    _userMessage: string,
    _nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;

    if (!ctx.appointmentId) {
      return {
        reply: "N\u00e3o encontrei o agendamento acompanhado nesta conversa. Posso ajud\u00e1-lo com um novo servi\u00e7o?",
        nextState: "INICIO",
        contextUpdate: { appointmentStatus: undefined },
      };
    }

    const client = await ClientModel.findOne({ where: { user_id: userId } });
    const appointment = client
      ? await AppointmentModel.findOne({
          where: { id: ctx.appointmentId, client_id: client.id },
        })
      : null;

    if (!appointment) {
      return {
        reply: "N\u00e3o foi poss\u00edvel localizar esse agendamento. Posso ajud\u00e1-lo com outra solicita\u00e7\u00e3o?",
        nextState: "INICIO",
        contextUpdate: { appointmentStatus: undefined },
      };
    }

    if (appointment.status === "pending") {
      return {
        reply:
          `O agendamento ID ${appointment.id} ainda est\u00e1 pendente. ` +
          "O profissional tem at\u00e9 12 horas para responder. " +
          "Voc\u00ea n\u00e3o precisa manter esta tela aberta: atualizaremos a conversa automaticamente.",
        nextState: "AGUARDANDO_CONFIRMACAO",
        contextUpdate: { appointmentStatus: "pending" },
      };
    }

    const replies = {
      confirmed: `\u2705 O profissional confirmou o agendamento ID ${appointment.id}. A conversa permanece dispon\u00edvel no seu hist\u00f3rico.`,
      canceled: `\u274c O agendamento ID ${appointment.id} foi recusado ou cancelado. Posso ajud\u00e1-lo a escolher outra op\u00e7\u00e3o.`,
      completed: `\u2705 O agendamento ID ${appointment.id} foi conclu\u00eddo. Posso ajud\u00e1-lo com mais alguma coisa?`,
    } as const;

    return {
      reply: replies[appointment.status],
      nextState: "INICIO",
      contextUpdate: { appointmentStatus: appointment.status },
    };
  }
}

import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { cancelBotAppointment, createBotAppointment } from "./appointmentActions";
import { formatDatePtBR } from "../../../utils/date.util";
import { logError } from "../../../utils/logger";

export class ConfirmacaoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
    selectedTimeIso?: string
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const lower = userMessage.toLowerCase().trim();
    const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
    const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

    if (!confirmed && !denied) {
      return {
        reply: "Por favor, responda com *sim* para confirmar ou *não* para cancelar:",
        nextState: "CONFIRMACAO",
        contextUpdate: {
          serviceOptions: ["Sim", "Não"],
          serviceOptionsData: undefined,
        },
      };
    }

    if (denied) {
      return {
        reply:
          ctx.pendingAction === "CANCEL"
            ? "Ok, o cancelamento foi descartado. Posso ajudá-lo com mais alguma coisa?"
            : "Ok, agendamento descartado. Gostaria de escolher outra data ou horário?",
        nextState: ctx.pendingAction === "CANCEL" ? "FINALIZADO" : "COLETANDO_DATA",
        contextUpdate: { time: undefined, newTime: undefined },
        finalize: ctx.pendingAction === "CANCEL",
      };
    }

    const pendingAction = ctx.pendingAction ?? "CREATE";

    try {
      if (pendingAction === "CANCEL") {
        if (!ctx.appointmentId) throw new Error("ID do agendamento não encontrado na sessão");
        await cancelBotAppointment(userId, ctx.appointmentId);
        return {
          reply: `✅ Agendamento ID ${ctx.appointmentId} cancelado com sucesso.`,
          nextState: "FINALIZADO",
          contextUpdate: {},
          finalize: true,
        };
      }

      if (pendingAction === "RESCHEDULE") {
        if (!ctx.appointmentId) throw new Error("ID do agendamento original não encontrado");
        await cancelBotAppointment(userId, ctx.appointmentId);
        
        const reschedCtx: BotSessionContext = {
          ...ctx,
          date: ctx.newDate ?? ctx.date,
          time: ctx.newTime ?? ctx.time,
        };
        const newAppointment = await createBotAppointment(userId, reschedCtx, selectedTimeIso);
        return {
          reply:
            `✅ Reagendamento concluído!\n\n` +
            `Novo agendamento ID: ${newAppointment.id}\n` +
            `Serviço: ${ctx.serviceName}\n` +
            `Data: ${formatDatePtBR(reschedCtx.date!)}\n` +
            `Horário: ${reschedCtx.time}\n\n` +
            `Aguarde a confirmação do profissional.`,
          nextState: "AGUARDANDO_CONFIRMACAO",
          contextUpdate: {
            appointmentId: newAppointment.id,
            appointmentStatus: "pending",
          },
          appointmentId: newAppointment.id,
        };
      }

      // CREATE
      const appointment = await createBotAppointment(userId, ctx, selectedTimeIso);
      return {
        reply:
          `✅ Agendamento criado com sucesso!\n\n` +
          `ID: ${appointment.id}\n` +
          `Serviço: ${ctx.serviceName}\n` +
          `Data: ${formatDatePtBR(ctx.date!)}\n` +
          `Horário: ${ctx.time}\n\n` +
          `Aguarde a confirmação do profissional. Você receberá uma notificação.`,
        nextState: "AGUARDANDO_CONFIRMACAO",
        contextUpdate: {
          appointmentId: appointment.id,
          appointmentStatus: "pending",
        },
        appointmentId: appointment.id,
      };
    } catch (error: any) {
      logError("Bot: erro ao executar ação de confirmação", error, { userId });
      return {
        reply: `❌ ${error.message ?? "Ocorreu um erro. Por favor, tente novamente."}`,
        nextState: pendingAction === "CREATE" || pendingAction === "RESCHEDULE"
          ? "COLETANDO_HORARIO"
          : "INICIO",
        contextUpdate: { time: undefined, newTime: undefined },
      };
    }
  }
}

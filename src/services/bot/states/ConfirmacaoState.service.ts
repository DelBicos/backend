import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { BotAddressValidationError, createBotAppointment, rescheduleBotAppointment } from "./appointmentActions.service";
import { handleCancellationCode } from "./cancellationCode.service";
import { collectBookingDetails, requestBookingAddress } from "./bookingDetails.service";
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
    const pendingAction = ctx.pendingAction ?? "CREATE";
    if (pendingAction === "CANCEL" && ctx.cancellationChallengeId) {
      return handleCancellationCode(userMessage, ctx, userId);
    }
    if (pendingAction === "CREATE" &&
        (ctx.bookingDetailsStep === "ADDRESS" ||
         /^(?:trocar|mudar|outro|alterar)(?: o)? endere[cç]o[.!?]?$/.test(lower)) &&
        !/^(?:n[aã]o|cancelar|desistir|voltar)[.!?]?$/.test(lower)) {
      return collectBookingDetails(userMessage, ctx, userId);
    }
    // Alterações de reservas exigem autorização explícita, sem perguntas ou ressalvas.
    const confirmed = pendingAction === "CANCEL" || pendingAction === "RESCHEDULE"
      ? /^(?:sim(?:,?\s+(?:confirmar|confirmo))?|s|yes|confirmar|confirmo|ok|pode|vamos)[.!]*$/.test(lower) ||
        (pendingAction === "CANCEL" && /^confirmar cancelamento[.!]*$/.test(lower))
      : /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
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
        contextUpdate: { time: undefined, newTime: undefined, bookingDetailsStep: undefined,
          addressId: undefined, addressLabel: undefined, addressOptions: undefined },
        finalize: ctx.pendingAction === "CANCEL",
      };
    }

    try {
      if (pendingAction === "CANCEL") {
        return handleCancellationCode(userMessage, ctx, userId);
      }

      if (pendingAction === "RESCHEDULE") {
        if (!ctx.appointmentId) throw new Error("ID do agendamento original não encontrado");
        const reschedCtx: BotSessionContext = {
          ...ctx,
          date: ctx.newDate ?? ctx.date,
          time: ctx.newTime ?? ctx.time,
        };
        const rescheduledAppointment = await rescheduleBotAppointment(userId, reschedCtx, selectedTimeIso);
        return {
          reply:
            `✅ Reagendamento concluído!\n\n` +
            `Agendamento ID: ${rescheduledAppointment.id}\n` +
            `Serviço: ${ctx.serviceName}\n` +
            `Data: ${formatDatePtBR(reschedCtx.date!)}\n` +
            `Horário: ${reschedCtx.time}\n\n` +
            `Aguarde a confirmação do profissional.`,
          nextState: "AGUARDANDO_CONFIRMACAO",
          contextUpdate: {
            appointmentId: rescheduledAppointment.id,
            appointmentStatus: rescheduledAppointment.status,
            appointmentPaid: Boolean(rescheduledAppointment.payment_intent_id),
          },
          appointmentId: rescheduledAppointment.id,
        };
      }

      // CREATE
      if (ctx.bookingDetailsStep !== "REVIEW" || !ctx.addressId) {
        return requestBookingAddress(userId);
      }
      const appointment = await createBotAppointment(userId, ctx, selectedTimeIso);
      return {
        reply:
          `✅ Agendamento criado com sucesso!\n\n` +
          `ID: ${appointment.id}\n` +
          `Serviço: ${ctx.serviceName}\n` +
          `Data: ${formatDatePtBR(ctx.date!)}\n` +
          `Horário: ${ctx.time}\n` +
          `Endereço: ${ctx.addressLabel}\n` +
          `O agendamento ficará pendente até a resposta do profissional. Você poderá fazer o pagamento pelo aplicativo enquanto aguarda.`,
        nextState: "AGUARDANDO_CONFIRMACAO",
        contextUpdate: {
          appointmentId: appointment.id,
          appointmentStatus: "pending",
          appointmentPaid: false,
          serviceOptions: [],
          bookingDetailsStep: undefined,
        },
        appointmentId: appointment.id,
      };
    } catch (error: unknown) {
      logError("Bot: erro ao executar ação de confirmação", error, { userId });
      if (error instanceof BotAddressValidationError) {
        const result = await requestBookingAddress(userId);
        return { ...result, reply: `${error.message}\n\n${result.reply}` };
      }
      return {
        reply: `❌ ${error instanceof Error ? error.message : "Ocorreu um erro. Por favor, tente novamente."}`,
        nextState: pendingAction === "CREATE" || pendingAction === "RESCHEDULE"
          ? "COLETANDO_HORARIO"
          : "INICIO",
        contextUpdate: { time: undefined, newTime: undefined, bookingDetailsStep: undefined,
          addressId: undefined, addressLabel: undefined },
      };
    }
  }
}

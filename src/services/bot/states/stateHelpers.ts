import { BotSessionContext } from "../../../models/BotChatSession";
import { formatDatePtBR } from "../../../utils/date.util";
import { formatCurrency } from "../../../utils/format.util";
import { HandlerResult } from "../BotStateNode";

export function buildConfirmationResponse(
  ctx: BotSessionContext,
  date: string,
  time: string,
  ctxUpdate: Partial<BotSessionContext>,
): HandlerResult {
  const isAlterar = ctx.pendingAction === "RESCHEDULE";
  const price = ctx.servicePrice != null ? formatCurrency(ctx.servicePrice, undefined) : "";
  const oldInfo = isAlterar && ctx.appointmentId
    ? `\n\n📋 Agendamento original (ID ${ctx.appointmentId}) será cancelado automaticamente.`
    : "";

  return {
    reply:
      `📅 *Resumo do agendamento:*\n\n` +
      `Serviço: ${ctx.serviceName ?? "N/A"}\n` +
      `Profissional: ${ctx.professionalName ?? "N/A"}\n` +
      `Data: ${formatDatePtBR(date)}\n` +
      `Horário: ${time}\n` +
      (price ? `Valor: ${price}\n` : "") +
      oldInfo +
      `\nConfirma? Responda com *sim* para confirmar ou *não* para cancelar.`,
    nextState: "CONFIRMACAO",
    contextUpdate: {
      ...ctxUpdate,
      serviceOptions: ["Sim", "Não"],
      serviceOptionsData: undefined,
    },
  };
}

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
  const rating =
    ctx.professionalRatingsCount && ctx.professionalRating != null
      ? `${ctx.professionalRating.toFixed(1)} (${ctx.professionalRatingsCount} ${
          ctx.professionalRatingsCount === 1 ? "avaliação" : "avaliações"
        } neste serviço)`
      : "Novo profissional neste serviço";
  const location =
    ctx.professionalCity && ctx.professionalState
      ? `${ctx.professionalCity}/${ctx.professionalState}`
      : "";
  const oldInfo = isAlterar && ctx.appointmentId
    ? `\n\n📋 Agendamento original (ID ${ctx.appointmentId}) será cancelado automaticamente.`
    : "";

  return {
    reply:
      `📅 *Resumo do agendamento:*\n\n` +
      `Serviço: ${ctx.serviceName ?? "N/A"}\n` +
      (ctx.serviceSubcategoryName
        ? `Subcategoria: ${ctx.serviceSubcategoryName}\n`
        : "") +
      `Profissional: ${ctx.professionalName ?? "N/A"}\n` +
      `Avaliação: ${rating}\n` +
      (location ? `Localização: ${location}\n` : "") +
      `Data: ${formatDatePtBR(date)}\n` +
      `Horário: ${time}\n` +
      (ctx.serviceDuration ? `Duração: ${ctx.serviceDuration} minutos\n` : "") +
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

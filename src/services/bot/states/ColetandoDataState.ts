import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { parsePortugueseDate, isValidFutureDate, formatDatePtBR } from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { buildConfirmationResponse } from "./stateHelpers";

export class ColetandoDataState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;

    let date: string | undefined | null;

    // Se o usuário escolheu um número de uma lista de datas sugeridas
    if (ctx.suggestedDates && ctx.suggestedDates.length > 0) {
      const choice = parseInt(userMessage.trim(), 10);
      if (!isNaN(choice) && choice >= 1 && choice <= ctx.suggestedDates.length) {
        date = ctx.suggestedDates[choice - 1];
      }
    }

    // Tenta extrair a data: primeiro do parser local (D/M/Y, D/M, extenso), depois do NLU
    if (!date) {
      date = parsePortugueseDate(userMessage) ?? nlu.entities.date;
    }

    if (!date || !isValidFutureDate(date)) {
      return {
        reply:
          "Por favor, informe uma data válida no futuro.\nFormatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como \"amanhã\", \"próxima segunda\".",
        nextState: "COLETANDO_DATA",
        contextUpdate: {},
      };
    }

    const isAlterar = ctx.pendingAction === "RESCHEDULE";
    const field = isAlterar ? "newDate" : "date";

    // Se for reagendamento (ALTERAR) e já temos o horário, podemos validar direto
    const chosenTime = isAlterar ? ctx.newTime : ctx.time;
    if (isAlterar && chosenTime && ctx.professionalId && ctx.serviceId) {
      const slots = await getAvailableSlots(ctx.professionalId, date, ctx.serviceDuration ?? 60, ctx.serviceId);
      if (slots.includes(chosenTime)) {
        return buildConfirmationResponse(ctx, date, chosenTime, { [field]: date, suggestedSlots: undefined });
      }
      // Caso contrário, segue o fluxo normal sugerindo alternativas para o reagendamento
    }

    // Busca todos os profissionais que oferecem o serviço selecionado e suas disponibilidades na data
    const matchedServiceIds = ctx.matchedServiceIds ?? [];
    if (matchedServiceIds.length === 0 && ctx.serviceId) {
      matchedServiceIds.push(ctx.serviceId);
    }

    const matchingServices = await ServiceModel.findAll({
      where: { id: matchedServiceIds, active: true },
      include: [
        {
          model: ProfessionalModel,
          as: "Professional",
          include: [{ model: UserModel, as: "User", attributes: ["name"] }],
        },
      ],
    });

    const duration = ctx.serviceDuration ?? 60;
    const lines: string[] = [];
    let optionIndex = 1;
    const suggestedSlotsData: Array<{
      index: number;
      serviceId: number;
      professionalId: number;
      professionalName: string;
      price: number;
      duration: number;
      time: string;
    }> = [];

    for (const svc of matchingServices) {
      const profName = (svc as any).Professional?.User?.name || "Profissional";
      const slots = await getAvailableSlots(svc.professional_id, date, duration, svc.id);
      
      if (slots.length > 0) {
        const formattedSlots = slots.map(s => {
          const idx = optionIndex++;
          suggestedSlotsData.push({
            index: idx,
            serviceId: svc.id,
            professionalId: svc.professional_id,
            professionalName: profName,
            price: svc.price_cents ?? Math.round(Number(svc.price) * 100),
            duration: svc.duration,
            time: s,
          });
          return `  ${idx} — ${s}`;
        });
        lines.push(`• ${profName}:\n${formattedSlots.join("\n")}`);
      }
    }

    if (suggestedSlotsData.length === 0) {
      // Busca dias próximos com disponibilidade (até 14 dias à frente)
      const alternativeDates: Array<{ dateStr: string; slotCount: number }> = [];
      const baseDate = new Date(date + "T12:00:00.000Z");

      for (let offset = 1; offset <= 14 && alternativeDates.length < 3; offset++) {
        const nextDate = new Date(baseDate);
        nextDate.setUTCDate(nextDate.getUTCDate() + offset);
        const nextDateStr = nextDate.toISOString().split("T")[0];

        let totalSlots = 0;
        for (const svc of matchingServices) {
          const slots = await getAvailableSlots(svc.professional_id, nextDateStr, duration, svc.id);
          totalSlots += slots.length;
          if (totalSlots > 0) break; // basta saber que tem ao menos 1 slot
        }
        if (totalSlots > 0) {
          alternativeDates.push({ dateStr: nextDateStr, slotCount: totalSlots });
        }
      }

      if (alternativeDates.length > 0) {
        const weekdayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
        const suggestions = alternativeDates.map((alt, i) => {
          const d = new Date(alt.dateStr + "T12:00:00.000Z");
          const weekday = weekdayNames[d.getUTCDay()];
          return `  ${i + 1} — ${weekday}, ${formatDatePtBR(alt.dateStr)}`;
        });

        return {
          reply:
            `Infelizmente não encontrei profissionais disponíveis no dia ${formatDatePtBR(date)} para o serviço "${ctx.serviceName}".\n\n` +
            `Mas encontrei disponibilidade nos próximos dias:\n\n` +
            `${suggestions.join("\n")}\n\n` +
            `Escolha o número da data desejada, ou informe outra data:`,
          nextState: "COLETANDO_DATA", // wait, nextState should be "COLETANDO_DATA"
          contextUpdate: {
            [field]: date,
            suggestedDates: alternativeDates.map(a => a.dateStr),
          },
        };
      }

      return {
        reply: `Infelizmente não encontrei profissionais disponíveis no dia ${formatDatePtBR(date)} nem nos próximos 14 dias para o serviço "${ctx.serviceName}". Por favor, informe outra data:`,
        nextState: "COLETANDO_DATA",
        contextUpdate: { [field]: date },
      };
    }

    const serviceOptions = suggestedSlotsData.map(d => String(d.index));

    return {
      reply:
        `Para ${formatDatePtBR(date)}, temos estes profissionais e horários disponíveis:\n\n` +
        `${lines.join("\n\n")}\n\n` +
        `Escolha o número correspondente à sua preferência, ou informe outro horário de preferência (ex: 'quero às 15:00'):`,
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {
        [field]: date,
        suggestedSlots: serviceOptions,
        suggestedSlotsData,
      },
    };
  }
}

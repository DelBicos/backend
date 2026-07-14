import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { parseTimeFromText, formatDatePtBR } from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { buildConfirmationResponse } from "./stateHelpers";

export class ColetandoHorarioState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const isAlterar = ctx.pendingAction === "RESCHEDULE";
    const date = isAlterar ? (ctx.newDate ?? ctx.date) : ctx.date;

    // 1. Verifica se usuário está escolhendo de uma lista numerada de sugestões
    if (ctx.suggestedSlotsData && ctx.suggestedSlotsData.length > 0) {
      const choice = parseInt(userMessage.trim(), 10);
      if (!isNaN(choice) && choice >= 1 && choice <= ctx.suggestedSlotsData.length) {
        const pickedSlot = ctx.suggestedSlotsData[choice - 1];
        const field = isAlterar ? "newTime" : "time";
        
        const contextUpdate: Partial<BotSessionContext> = {
          [field]: pickedSlot.time,
          serviceId: pickedSlot.serviceId,
          professionalId: pickedSlot.professionalId,
          professionalName: pickedSlot.professionalName,
          servicePrice: pickedSlot.price,
          serviceDuration: pickedSlot.duration,
          suggestedSlots: undefined,
          suggestedSlotsData: undefined,
        };

        return buildConfirmationResponse({ ...ctx, ...contextUpdate }, date!, pickedSlot.time, contextUpdate);
      }
    }

    // 2. Tenta obter o horário da mensagem
    const time = nlu.entities.time ?? parseTimeFromText(userMessage);
    if (!time) {
      return {
        reply: "Não consegui identificar o horário. Por favor, escolha uma opção pelo número, ou digite outro horário (ex: 14:30):",
        nextState: "COLETANDO_HORARIO",
        contextUpdate: {},
      };
    }

    // Se não temos a data ainda (reagendamento sem data), salva horário e pede data
    if (!date) {
      const field = isAlterar ? "newTime" : "time";
      return {
        reply: `Horário registrado: ${time}.\n\nQual data você prefere? (Formatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como "amanhã", "próxima segunda")`,
        nextState: "COLETANDO_DATA",
        contextUpdate: { [field]: time, suggestedSlots: undefined, suggestedSlotsData: undefined },
      };
    }

    // 3. Se o usuário forneceu um horário customizado, busca profissionais disponíveis nesse horário
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
    const availableForTime: typeof matchingServices = [];

    for (const svc of matchingServices) {
      const slots = await getAvailableSlots(svc.professional_id, date, duration, svc.id);
      if (slots.includes(time)) {
        availableForTime.push(svc);
      }
    }

    if (availableForTime.length > 0) {
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

      for (const svc of availableForTime) {
        const profName = (svc as any).Professional?.User?.name ?? "Profissional";
        const idx = optionIndex++;
        suggestedSlotsData.push({
          index: idx,
          serviceId: svc.id,
          professionalId: svc.professional_id,
          professionalName: profName,
          price: svc.price_cents ?? Math.round(svc.price * 100),
          duration: svc.duration,
          time: time,
        });
        lines.push(`${idx}. ${profName}`);
      }

      const serviceOptions = suggestedSlotsData.map(d => String(d.index));

      return {
        reply:
          `Para as ${time} em ${formatDatePtBR(date)}, temos estes profissionais disponíveis:\n\n` +
          `${lines.join("\n")}\n\n` +
          `Escolha o número correspondente à sua preferência:`,
        nextState: "COLETANDO_HORARIO",
        contextUpdate: {
          suggestedSlots: serviceOptions,
          suggestedSlotsData,
        },
      };
    }

    // Se nenhum profissional estiver disponível na hora sugerida
    return {
      reply:
        `Infelizmente nenhum profissional está disponível às ${time} em ${formatDatePtBR(date)}.\n\n` +
        `Por favor, escolha uma das opções listadas anteriormente ou tente outro horário:`,
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {}, // mantém as opções sugeridas anteriores
    };
  }
}

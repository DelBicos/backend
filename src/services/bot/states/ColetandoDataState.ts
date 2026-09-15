import { Op } from "sequelize";
import {
  BotChatSessionModel,
  BotDayProfessionalOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { UserModel } from "../../../models/User";
import {
  TimePeriod,
  formatDatePtBR,
  formatTimePeriodPtBR,
  isTimeInPeriod,
  isValidBookingDate,
  parsePortugueseDate,
  parseTimePeriodFromText,
  selectSuggestedDateByWeekday,
} from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";

const MAX_VISIBLE_PROFESSIONALS = 6;
const MAX_SUGGESTED_DATES = 3;
const AVAILABILITY_SEARCH_DAYS = 14;

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function matchingServiceIds(context: BotSessionContext): number[] {
  return Array.from(
    new Set([
      ...(context.matchedServiceIds ?? []),
      ...(context.serviceId ? [context.serviceId] : []),
    ]),
  );
}

async function loadMatchingServices(
  context: BotSessionContext,
): Promise<ServiceModel[]> {
  const ids = matchingServiceIds(context);
  if (ids.length === 0) return [];

  return ServiceModel.findAll({
    where: { id: { [Op.in]: ids }, active: true },
    include: [
      {
        model: ProfessionalModel,
        as: "Professional",
        required: true,
        include: [
          {
            model: UserModel,
            as: "User",
            attributes: ["name"],
          },
        ],
      },
    ],
  });
}

interface ServiceAvailability {
  service: ServiceModel;
  slots: string[];
}

async function loadServiceAvailability(
  services: ServiceModel[],
  date: string,
): Promise<ServiceAvailability[]> {
  const checks = await Promise.all(
    services.map(async (service) => {
      const slots = await getAvailableSlots(
        service.professional_id,
        date,
        service.duration ?? 60,
        service.id,
      );
      return slots.length > 0 ? { service, slots } : null;
    }),
  );

  return checks.filter(
    (availability): availability is ServiceAvailability =>
      availability !== null,
  );
}

function availableServices(
  availability: ServiceAvailability[],
  period?: TimePeriod,
): ServiceModel[] {
  return availability
    .filter(
      ({ slots }) =>
        !period || slots.some((slot) => isTimeInPeriod(slot, period)),
    )
    .map(({ service }) => service);
}

function dayProfessionals(
  services: ServiceModel[],
): BotDayProfessionalOption[] {
  const unique = new Map<number, BotDayProfessionalOption>();

  for (const service of services as Array<
    ServiceModel & { Professional?: { User?: { name?: string } } }
  >) {
    if (!unique.has(service.professional_id)) {
      unique.set(service.professional_id, {
        professionalId: service.professional_id,
        professionalName: service.Professional?.User?.name ?? "Profissional",
      });
    }
  }

  return Array.from(unique.values());
}

function professionalNamesReply(
  professionals: BotDayProfessionalOption[],
): string {
  const visible = professionals.slice(0, MAX_VISIBLE_PROFESSIONALS);
  const lines = visible.map(
    (professional) => `• ${professional.professionalName}`,
  );
  const remaining = professionals.length - visible.length;
  if (remaining > 0) {
    lines.push(
      `• e mais ${remaining} ${remaining === 1 ? "profissional" : "profissionais"}`,
    );
  }
  return lines.join("\n");
}

async function findSuggestedDates(
  services: ServiceModel[],
  unavailableDate: string,
  period?: TimePeriod,
): Promise<string[]> {
  const suggestions: string[] = [];

  for (
    let offset = 1;
    offset <= AVAILABILITY_SEARCH_DAYS &&
    suggestions.length < MAX_SUGGESTED_DATES;
    offset += 1
  ) {
    const candidate = addDays(unavailableDate, offset);
    const available = availableServices(
      await loadServiceAvailability(services, candidate),
      period,
    );
    if (available.length > 0) suggestions.push(candidate);
  }

  return suggestions;
}

export class ColetandoDataState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    _userId: number,
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const isAlterar = ctx.pendingAction === "RESCHEDULE";
    const periodField = isAlterar ? "newTimePeriod" : "timePeriod";
    const timeField = isAlterar ? "newTime" : "time";
    const requestedPeriod =
      nlu.entities.time_period ??
      parseTimePeriodFromText(userMessage) ??
      (isAlterar ? ctx.newTimePeriod : ctx.timePeriod);

    let date: string | undefined | null;

    if (ctx.suggestedDates?.length) {
      const trimmedChoice = userMessage.trim();
      const choice = /^\d+$/.test(trimmedChoice)
        ? Number(trimmedChoice)
        : Number.NaN;
      if (
        !isNaN(choice) &&
        choice >= 1 &&
        choice <= ctx.suggestedDates.length
      ) {
        date = ctx.suggestedDates[choice - 1];
      } else {
        date = selectSuggestedDateByWeekday(userMessage, ctx.suggestedDates);
      }
    }

    if (!date) {
      date =
        parsePortugueseDate(userMessage, { timeZone: ctx.timeZone }) ??
        nlu.entities.date;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        reply:
          "Não consegui identificar o dia. Informe somente a data desejada.\n" +
          'Exemplos: 13/08, dia 13, 13 de agosto ou "próxima segunda".',
        nextState: "COLETANDO_DATA",
        contextUpdate: {},
      };
    }

    if (!isValidBookingDate(date, { timeZone: ctx.timeZone })) {
      return {
        reply:
          "Os agendamentos precisam ser feitos com no mínimo 48 horas (2 dias) de antecedência. " +
          "Qual outro dia você prefere?",
        nextState: "COLETANDO_DATA",
        contextUpdate: {},
      };
    }

    const services = await loadMatchingServices(ctx);
    if (services.length === 0) {
      return {
        reply:
          "Esse serviço não possui mais ofertas ativas. Qual outro serviço você gostaria de agendar?",
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          serviceId: undefined,
          serviceName: undefined,
          serviceDescription: undefined,
          serviceSubcategoryId: undefined,
          serviceSubcategoryName: undefined,
          serviceCategoryName: undefined,
          matchedServiceIds: undefined,
          availableDayServiceIds: undefined,
          availableDayProfessionals: undefined,
          suggestedDates: undefined,
        },
      };
    }

    const dayAvailability = await loadServiceAvailability(services, date);
    const allDayServices = availableServices(dayAvailability);
    const matchingPeriodServices = availableServices(
      dayAvailability,
      requestedPeriod ?? undefined,
    );

    if (matchingPeriodServices.length === 0) {
      const suggestions = await findSuggestedDates(
        services,
        date,
        requestedPeriod ?? undefined,
      );
      const periodText = requestedPeriod
        ? ` no período ${formatTimePeriodPtBR(requestedPeriod)}`
        : "";
      const suggestionsText = suggestions.length
        ? `\n\nEncontrei disponibilidade nestes dias:\n${suggestions
            .map(
              (suggestion, index) =>
                `${index + 1}. ${formatDatePtBR(suggestion)}`,
            )
            .join("\n")}\n\nEscolha um número ou informe outro dia.`
        : " Qual outro dia você prefere?";

      return {
        reply:
          `Não encontrei profissionais disponíveis em ${formatDatePtBR(date)}${periodText}.` +
          suggestionsText,
        nextState: "COLETANDO_DATA",
        contextUpdate: {
          [periodField]: requestedPeriod ?? undefined,
          [timeField]: undefined,
          suggestedDates: suggestions.length ? suggestions : undefined,
          availableDayServiceIds: undefined,
          availableDayProfessionals: undefined,
          professionalOptionsData: undefined,
          suggestedSlots: undefined,
          suggestedSlotsData: undefined,
        },
      };
    }

    const field = isAlterar ? "newDate" : "date";
    const professionals = dayProfessionals(matchingPeriodServices);
    const periodHint = requestedPeriod
      ? ` no período ${formatTimePeriodPtBR(requestedPeriod)}`
      : "";

    return {
      reply:
        `Em ${formatDatePtBR(date)}, estes profissionais têm disponibilidade para "${ctx.serviceName ?? "o serviço"}":\n\n` +
        `${professionalNamesReply(professionals)}\n\n` +
        `Qual horário você prefere${periodHint}? ` +
        "(Ex.: 09:00, 14:30, manhã ou tarde)",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {
        [field]: date,
        [periodField]: requestedPeriod ?? undefined,
        [timeField]: undefined,
        suggestedDates: undefined,
        suggestedSlots: undefined,
        suggestedSlotsData: undefined,
        professionalOptionsData: undefined,
        // Mantém todas as ofertas livres do dia. Assim, se o usuário mudar de
        // manhã para tarde (ou vice-versa), a próxima etapa reconsulta o
        // conjunto completo em vez de omitir profissionais válidos.
        availableDayServiceIds: allDayServices.map((service) => service.id),
        availableDayProfessionals: professionals,
      },
    };
  }
}

import { Op } from "sequelize";
import { AddressModel } from "../../../models/Address";
import { AppointmentModel } from "../../../models/Appointment";
import {
  BotChatSessionModel,
  BotProfessionalOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { ProfessionalModel } from "../../../models/Professional";
import { ServiceModel } from "../../../models/Service";
import { UserModel } from "../../../models/User";
import {
  formatDatePtBR,
  formatTimePeriodPtBR,
  isTimeInPeriod,
  parsePortugueseDate,
  parseTimeFromText,
  parseTimePeriodFromText,
  resolveAmbiguousTimeFromAvailableSlots,
} from "../../../utils/date.util";
import { getAvailableSlots } from "../../availability.service";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { ColetandoDataState } from "./ColetandoDataState";
import { buildConfirmationResponse } from "./stateHelpers";

const MAX_TIME_SUGGESTIONS = 6;

async function loadMatchingServices(
  context: BotSessionContext,
): Promise<ServiceModel[]> {
  const ids = Array.from(
    new Set([
      ...(context.availableDayServiceIds?.length
        ? context.availableDayServiceIds
        : [
            ...(context.matchedServiceIds ?? []),
            ...(context.serviceId ? [context.serviceId] : []),
          ]),
    ]),
  );
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
            attributes: ["name", "avatar_uri"],
          },
          {
            model: AddressModel,
            as: "MainAddress",
            attributes: ["city", "state"],
            required: false,
          },
        ],
      },
      {
        model: AppointmentModel,
        as: "Appointments",
        attributes: ["rating"],
        where: {
          status: "completed",
          rating: { [Op.not]: null },
        },
        required: false,
      },
    ],
  });
}

async function availableTimesForService(
  service: any,
  date: string,
): Promise<string[]> {
  return getAvailableSlots(
    service.professional_id,
    date,
    service.duration ?? 60,
    service.id,
  );
}

function buildProfessionalOption(
  service: any,
  index: number,
  time: string,
): BotProfessionalOption {
  const ratings = (service.Appointments ?? [])
    .map((appointment: AppointmentModel) => appointment.rating)
    .filter(
      (rating: number | null | undefined): rating is number =>
        typeof rating === "number",
    );
  const rating = ratings.length
    ? Number(
        (
          ratings.reduce((total: number, value: number) => total + value, 0) /
          ratings.length
        ).toFixed(1),
      )
    : 0;

  return {
    index,
    serviceId: service.id,
    professionalId: service.professional_id,
    professionalName: service.Professional?.User?.name ?? "Profissional",
    professionalAvatarUri: service.Professional?.User?.avatar_uri ?? null,
    professionalRating: rating,
    professionalRatingsCount: ratings.length,
    professionalCity: service.Professional?.MainAddress?.city ?? null,
    professionalState: service.Professional?.MainAddress?.state ?? null,
    price: service.price_cents ?? Math.round(Number(service.price ?? 0) * 100),
    duration: service.duration ?? 60,
    time,
  };
}

function professionalContextUpdate(
  option: BotProfessionalOption,
  timeField: "time" | "newTime",
): Partial<BotSessionContext> {
  return {
    [timeField]: option.time,
    serviceId: option.serviceId,
    professionalId: option.professionalId,
    professionalName: option.professionalName,
    professionalAvatarUri: option.professionalAvatarUri,
    professionalRating: option.professionalRating,
    professionalRatingsCount: option.professionalRatingsCount,
    professionalCity: option.professionalCity,
    professionalState: option.professionalState,
    servicePrice: option.price,
    serviceDuration: option.duration,
    professionalOptionsData: undefined,
    suggestedSlots: undefined,
    suggestedSlotsData: undefined,
  };
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function rankAlternativeTimes(
  times: string[],
  requestedTime: string,
): string[] {
  const requestedMinutes = timeToMinutes(requestedTime);
  const requestedHalf = requestedMinutes < 12 * 60 ? 0 : 1;
  const hasSameHalf = times.some(
    (value) => (timeToMinutes(value) < 12 * 60 ? 0 : 1) === requestedHalf,
  );

  return [...times].sort((left, right) => {
    const leftMinutes = timeToMinutes(left);
    const rightMinutes = timeToMinutes(right);
    if (hasSameHalf) {
      const leftHalf = leftMinutes < 12 * 60 ? 0 : 1;
      const rightHalf = rightMinutes < 12 * 60 ? 0 : 1;
      if (leftHalf !== rightHalf) {
        return leftHalf === requestedHalf ? -1 : 1;
      }
      const distance =
        Math.abs(leftMinutes - requestedMinutes) -
        Math.abs(rightMinutes - requestedMinutes);
      if (distance !== 0) return distance;
    }
    return leftMinutes - rightMinutes;
  });
}

export class ColetandoHorarioState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const isAlterar = ctx.pendingAction === "RESCHEDULE";
    const date = isAlterar ? (ctx.newDate ?? ctx.date) : ctx.date;
    const timeField = isAlterar ? "newTime" : "time";
    const periodField = isAlterar ? "newTimePeriod" : "timePeriod";
    const preferredPeriod = isAlterar ? ctx.newTimePeriod : ctx.timePeriod;

    // Compatibilidade com sessões da versão anterior, nas quais a escolha do
    // profissional ainda era armazenada como um slot numerado neste estado.
    const trimmedMessage = userMessage.trim();
    const legacyChoice = /^\d+$/.test(trimmedMessage)
      ? Number(trimmedMessage)
      : Number.NaN;
    const legacyOption = Number.isNaN(legacyChoice)
      ? undefined
      : ctx.suggestedSlotsData?.find((option) => option.index === legacyChoice);
    if (legacyOption && date) {
      const option: BotProfessionalOption = {
        index: legacyOption.index,
        serviceId: legacyOption.serviceId,
        professionalId: legacyOption.professionalId,
        professionalName: legacyOption.professionalName,
        price: legacyOption.price,
        duration: legacyOption.duration,
        time: legacyOption.time,
      };
      const update = professionalContextUpdate(option, timeField);
      return buildConfirmationResponse(
        { ...ctx, ...update },
        date,
        option.time,
        update,
      );
    }

    const parsedTime = nlu.entities.time ?? parseTimeFromText(userMessage);
    let time = parsedTime
      ? resolveAmbiguousTimeFromAvailableSlots(
          userMessage,
          parsedTime,
          ctx.suggestedSlots ?? [],
          preferredPeriod,
        )
      : null;

    const requestedDate =
      nlu.entities.date ??
      parsePortugueseDate(userMessage, { timeZone: ctx.timeZone });
    if (requestedDate && (!time || requestedDate !== date)) {
      // Trocar o dia deve repetir a validação de disponibilidade e mostrar
      // novamente quem atende naquela data antes de solicitar o horário. A
      // data tem precedência quando a mesma mensagem também contém uma hora.
      return new ColetandoDataState().handle(userMessage, nlu, session, userId);
    }

    const matchingServices = await loadMatchingServices(ctx);

    if (!time) {
      const requestedPeriod =
        nlu.entities.time_period ?? parseTimePeriodFromText(userMessage);

      if (requestedPeriod && date) {
        const availableTimes = new Set<string>();
        for (const service of matchingServices) {
          const slots = await availableTimesForService(service, date);
          slots
            .filter((slot) => isTimeInPeriod(slot, requestedPeriod))
            .forEach((slot) => availableTimes.add(slot));
        }

        const suggestions = Array.from(availableTimes)
          .sort()
          .slice(0, MAX_TIME_SUGGESTIONS);
        if (suggestions.length > 0) {
          return {
            reply:
              `Tenho estes horários ${formatTimePeriodPtBR(requestedPeriod)} em ${formatDatePtBR(date)}:\n\n` +
              `${suggestions.join(" • ")}\n\n` +
              "Qual horário você prefere?",
            nextState: "COLETANDO_HORARIO",
            contextUpdate: {
              [periodField]: requestedPeriod,
              suggestedSlots: suggestions,
              suggestedSlotsData: undefined,
              professionalOptionsData: undefined,
            },
          };
        }

        return {
          reply:
            `Não encontrei horários ${formatTimePeriodPtBR(requestedPeriod)} em ${formatDatePtBR(date)}. ` +
            "Você prefere manhã, tarde, noite ou quer informar outro dia?",
          nextState: "COLETANDO_HORARIO",
          contextUpdate: {
            [periodField]: requestedPeriod,
            suggestedSlots: undefined,
          },
        };
      }

      return {
        reply:
          "Não consegui identificar o horário. Informe uma hora (ex.: 09:00 ou 14:30) " +
          "ou um período (manhã, tarde ou noite).",
        nextState: "COLETANDO_HORARIO",
        contextUpdate: {},
      };
    }

    if (!date) {
      return {
        reply:
          `Horário registrado: ${time}.\n\n` +
          'Qual dia você prefere? (Ex.: 13/08 ou "próxima segunda")',
        nextState: "COLETANDO_DATA",
        contextUpdate: {
          [timeField]: time,
          suggestedSlots: undefined,
        },
      };
    }

    const availabilityByService: Array<{
      service: ServiceModel;
      slots: string[];
    }> = [];
    const allAvailableTimes = new Set<string>();

    for (const service of matchingServices) {
      const slots = await availableTimesForService(service, date);
      availabilityByService.push({ service, slots });
      slots.forEach((slot) => allAvailableTimes.add(slot));
    }

    // Expressões em formato de 12 horas, como "duas e meia", precisam dos
    // horários reais do dia para decidir entre 02:30 e 14:30.
    if (parsedTime) {
      time = resolveAmbiguousTimeFromAvailableSlots(
        userMessage,
        parsedTime,
        Array.from(allAvailableTimes),
        preferredPeriod,
      );
    }
    const inferredTimeNotice =
      parsedTime && parsedTime !== time
        ? `Entendi o horário informado como ${time}.\n\n`
        : "";

    const availableServices = availabilityByService
      .filter(({ slots }) => slots.includes(time))
      .map(({ service }) => service);
    const alternativeTimes = new Set<string>();
    availabilityByService.forEach(({ slots }) =>
      slots
        .filter((slot) => slot !== time)
        .forEach((slot) => alternativeTimes.add(slot)),
    );

    if (availableServices.length === 0) {
      const alternatives = rankAlternativeTimes(
        Array.from(alternativeTimes),
        time,
      ).slice(0, MAX_TIME_SUGGESTIONS);
      return {
        reply:
          inferredTimeNotice +
          `Nenhum profissional está disponível às ${time} em ${formatDatePtBR(date)}.` +
          (alternatives.length
            ? `\n\nTenho estes horários no mesmo dia: ${alternatives.join(" • ")}\nQual você prefere?`
            : " Qual outro horário ou dia você prefere?"),
        nextState: "COLETANDO_HORARIO",
        contextUpdate: {
          [timeField]: undefined,
          suggestedSlots: alternatives.length ? alternatives : undefined,
          professionalOptionsData: undefined,
        },
      };
    }

    const uniqueByProfessional = new Map<number, ServiceModel>();
    for (const service of availableServices) {
      if (!uniqueByProfessional.has(service.professional_id)) {
        uniqueByProfessional.set(service.professional_id, service);
      }
    }
    const professionalOptions = Array.from(uniqueByProfessional.values()).map(
      (service, index) => buildProfessionalOption(service, index + 1, time),
    );

    return {
      reply:
        inferredTimeNotice +
        `Encontrei estes profissionais livres às ${time} em ${formatDatePtBR(date)}:\n\n` +
        `${professionalOptions.map((option) => `${option.index}. ${option.professionalName}`).join("\n")}\n\n` +
        "Qual profissional você prefere? Envie o número ou o nome.",
      nextState: "SELECIONANDO_PROFISSIONAL",
      contextUpdate: {
        [timeField]: time,
        professionalOptionsData: professionalOptions,
        suggestedSlots: undefined,
        suggestedSlotsData: undefined,
      },
    };
  }
}

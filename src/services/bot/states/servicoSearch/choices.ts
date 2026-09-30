import { BotServiceChoice, BotServiceOption, BotSessionContext } from "../../../../models/BotChatSession";
import type { HandlerResult } from "../../BotStateNode";
import type { BotCatalogService } from "./types";

export function buildServiceOption(service: BotCatalogService): BotServiceOption {
  const ratings = (service.Appointments ?? [])
    .map((appointment) => appointment.rating)
    .filter((rating): rating is number => typeof rating === "number");

  return {
    id: service.id,
    title: service.title,
    description: service.description ?? null,
    subcategoryId: service.subcategory_id,
    subcategoryName: service.Subcategory?.title ?? "Sem subcategoria",
    categoryName: service.Subcategory?.Category?.title ?? null,
    professionalId: service.professional_id,
    professionalName: service.Professional?.User?.name ?? "Profissional",
    professionalAvatarUri: service.Professional?.User?.avatar_uri ?? null,
    professionalDescription: service.Professional?.description ?? null,
    professionalCity: service.Professional?.MainAddress?.city ?? null,
    professionalState: service.Professional?.MainAddress?.state ?? null,
    price: service.price_cents ?? Math.round(Number(service.price) * 100),
    duration: service.duration,
    rating:
      ratings.length > 0
        ? Number(
            (
              ratings.reduce(
                (total: number, value: number) => total + value,
                0,
              ) / ratings.length
            ).toFixed(1),
          )
        : 0,
    ratingsCount: ratings.length,
  };
}


export function serviceChoiceResponse(choice: BotServiceChoice): HandlerResult {
  return {
    reply:
      `Perfeito! Vamos agendar "${choice.title}".\n\n` +
      "Para qual dia você quer o serviço? " +
      '(Ex.: 13/08, dia 13, 13 de agosto ou "próxima segunda")',
    nextState: "COLETANDO_DATA",
    contextUpdate: {
      serviceId: undefined,
      serviceName: choice.title,
      serviceDescription: choice.description,
      serviceSubcategoryId: choice.subcategoryId,
      serviceSubcategoryName: choice.subcategoryName,
      serviceCategoryName: choice.categoryName,
      servicePrice: undefined,
      serviceDuration: undefined,
      professionalId: undefined,
      professionalName: undefined,
      professionalAvatarUri: undefined,
      professionalRating: undefined,
      professionalRatingsCount: undefined,
      professionalCity: undefined,
      professionalState: undefined,
      matchedServiceIds: choice.matchedServiceIds,
      pendingService: null,
      serviceOptions: undefined,
      serviceOptionsData: undefined,
      serviceChoicesData: undefined,
      suggestedSlots: undefined,
      suggestedSlotsData: undefined,
      availableDayServiceIds: undefined,
      availableDayProfessionals: undefined,
      date: undefined,
      time: undefined,
      timePeriod: undefined,
      newDate: undefined,
      newTime: undefined,
      newTimePeriod: undefined,
    },
    serviceSearchOutcome: "MATCHED",
  };
}


export function serviceChoiceSummary(choice: BotServiceChoice, index: number): string {
  const category = [choice.categoryName, choice.subcategoryName]
    .filter(Boolean)
    .join(" › ");
  return `${index + 1}. ${choice.title}${category ? ` — ${category}` : ""}`;
}


export function clearedServiceSearchContext(): Partial<BotSessionContext> {
  return {
    serviceId: undefined,
    serviceName: undefined,
    serviceDescription: undefined,
    serviceSubcategoryId: undefined,
    serviceSubcategoryName: undefined,
    serviceCategoryName: undefined,
    servicePrice: undefined,
    serviceDuration: undefined,
    professionalId: undefined,
    professionalName: undefined,
    professionalAvatarUri: undefined,
    professionalRating: undefined,
    professionalRatingsCount: undefined,
    professionalCity: undefined,
    professionalState: undefined,
    matchedServiceIds: undefined,
    pendingService: null,
    serviceOptions: undefined,
    serviceOptionsData: undefined,
    serviceChoicesData: undefined,
    professionalOptionsData: undefined,
    suggestedSlots: undefined,
    suggestedSlotsData: undefined,
    suggestedDates: undefined,
    availableDayServiceIds: undefined,
    availableDayProfessionals: undefined,
    date: undefined,
    time: undefined,
    timePeriod: undefined,
    newDate: undefined,
    newTime: undefined,
    newTimePeriod: undefined,
  };
}


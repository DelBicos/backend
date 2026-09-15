import {
  BotServiceChoice,
  BotServiceOption,
  BotSessionContext,
} from "../../models/BotChatSession";
import { normalizeText } from "../../utils/nlp.util";

const SERVICE_TOKEN_CANONICAL_FORMS = new Map<string, string>([
  ["ambientes", "ambiente"],
  ["armarios", "armario"],
  ["azulejos", "azulejo"],
  ["disjuntores", "disjuntor"],
  ["fechaduras", "fechadura"],
  ["jardins", "jardim"],
  ["maos", "mao"],
  ["moveis", "movel"],
  ["muros", "muro"],
  ["pes", "pe"],
  ["pias", "pia"],
  ["profissionais", "profissional"],
  ["servicos", "servico"],
  ["tomadas", "tomada"],
  ["unhas", "unha"],
  ["vazamentos", "vazamento"],
  ["ventiladores", "ventilador"],
  ["vidros", "vidro"],
]);

/**
 * Canonicalização deliberadamente limitada ao vocabulário do catálogo.
 * Evita uma regra genérica de plural que corromperia palavras como gás e pés.
 */
export function canonicalizeServiceToken(token: string): string {
  return SERVICE_TOKEN_CANONICAL_FORMS.get(token) ?? token;
}

export function normalizeServiceChoiceTitleKey(title: string): string {
  return normalizeText(title)
    .split(" ")
    .filter(Boolean)
    .map(canonicalizeServiceToken)
    .join(" ");
}

export function groupServiceOptions(
  options: BotServiceOption[],
): BotServiceChoice[] {
  const groups = new Map<string, BotServiceChoice>();

  for (const option of options) {
    const key = `${normalizeServiceChoiceTitleKey(option.title)}|${option.subcategoryId}`;
    const current = groups.get(key);
    if (current) {
      if (!current.matchedServiceIds.includes(option.id)) {
        current.matchedServiceIds.push(option.id);
      }
      continue;
    }

    groups.set(key, {
      title: option.title,
      description: option.description,
      subcategoryId: option.subcategoryId,
      subcategoryName: option.subcategoryName,
      categoryName: option.categoryName,
      matchedServiceIds: [option.id],
    });
  }

  return Array.from(groups.values());
}

/**
 * Sessões anteriores persistiam uma opção completa para cada profissional.
 * Converte esse contexto para opções de serviço antes de devolvê-lo ao app,
 * evitando que os cartões antigos reapareçam durante a escolha do serviço.
 */
export function migrateLegacyServiceOptions(
  context: BotSessionContext,
): BotSessionContext {
  if (
    context.pendingService ||
    context.serviceChoicesData?.length ||
    !context.serviceOptionsData?.length
  ) {
    return context;
  }

  const choices = groupServiceOptions(context.serviceOptionsData).slice(0, 6);
  if (choices.length === 0) return context;

  return {
    ...context,
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
    availableDayServiceIds: undefined,
    availableDayProfessionals: undefined,
    serviceOptions: choices.map((choice) => choice.title),
    serviceOptionsData: undefined,
    serviceChoicesData: choices,
    professionalOptionsData: undefined,
    date: undefined,
    time: undefined,
    timePeriod: undefined,
    newDate: undefined,
    newTime: undefined,
    newTimePeriod: undefined,
    suggestedDates: undefined,
    suggestedSlots: undefined,
    suggestedSlotsData: undefined,
  };
}

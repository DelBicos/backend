import { Op } from "sequelize";
import { AppointmentModel } from "../../../models/Appointment";
import { ServiceModel } from "../../../models/Service";
import { SubCategoryModel } from "../../../models/Subcategory";
import { CategoryModel } from "../../../models/Category";
import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { AddressModel } from "../../../models/Address";
import {
  BotChatSessionModel,
  BotServiceChoice,
  BotServiceOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import {
  normalizeText,
  calculateMatchScore,
  findBestOptionMatch,
} from "../../../utils/nlp.util";
import {
  rankSemanticCandidates,
  SemanticSearchUnavailableError,
} from "../../semanticSearch.service";
import logger from "../../../utils/logger";
import {
  groupServiceOptions,
  migrateLegacyServiceOptions,
} from "../serviceChoice.helpers";

function buildServiceOption(service: any): BotServiceOption {
  const ratings = (service.Appointments ?? [])
    .map((appointment: AppointmentModel) => appointment.rating)
    .filter(
      (rating: number | null | undefined): rating is number =>
        typeof rating === "number",
    );

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

function serviceChoiceResponse(choice: BotServiceChoice): HandlerResult {
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
  };
}

function serviceChoiceSummary(choice: BotServiceChoice, index: number): string {
  const category = [choice.categoryName, choice.subcategoryName]
    .filter(Boolean)
    .join(" › ");
  return `${index + 1}. ${choice.title}${category ? ` — ${category}` : ""}`;
}

export class ColetandoServicoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
  ): Promise<HandlerResult> {
    const ctx = migrateLegacyServiceOptions(
      (session.context ?? {}) as BotSessionContext,
    );

    // 1. Se estamos aguardando confirmação do serviço selecionado
    if (ctx.pendingService) {
      const lower = userMessage.toLowerCase().trim();
      const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(
        lower,
      );
      const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

      if (!confirmed && !denied) {
        return {
          reply: `Por favor, responda com "sim" para confirmar o serviço "${ctx.pendingService.title}" ou "não" para buscar outro:`,
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            serviceOptions: ["Sim", "Não"],
            serviceOptionsData: undefined,
          },
        };
      }

      if (denied) {
        return {
          reply:
            "Ok, escolha cancelada. Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            pendingService: null,
            serviceOptions: undefined,
            serviceOptionsData: undefined,
          },
        };
      }

      return serviceChoiceResponse({
        title: ctx.pendingService.title,
        description: ctx.pendingService.description,
        subcategoryId: ctx.pendingService.subcategoryId,
        subcategoryName: ctx.pendingService.subcategoryName,
        categoryName: ctx.pendingService.categoryName,
        matchedServiceIds: [ctx.pendingService.id],
      });
    }

    // 2. Escolhe primeiro o tipo de serviço, sem antecipar a lista de profissionais.
    if (ctx.serviceChoicesData && ctx.serviceChoicesData.length > 0) {
      const choice = parseInt(userMessage.trim(), 10);
      const picked =
        !isNaN(choice) && choice >= 1 && choice <= ctx.serviceChoicesData.length
          ? ctx.serviceChoicesData[choice - 1]
          : findBestOptionMatch(userMessage, ctx.serviceChoicesData);

      if (picked) return serviceChoiceResponse(picked);

      return {
        reply:
          "Não identifiquei essa opção. Escolha um dos serviços pelo número ou pelo nome:\n\n" +
          ctx.serviceChoicesData.map(serviceChoiceSummary).join("\n"),
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {},
      };
    }

    // 3. Caso contrário, faz a busca pelo termo
    const searchTerm = nlu.entities.service ?? userMessage.trim();
    if (!searchTerm) {
      return {
        reply:
          "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {},
      };
    }

    const services = await ServiceModel.findAll({
      where: { active: true },
      include: [
        {
          model: SubCategoryModel,
          as: "Subcategory",
          include: [{ model: CategoryModel, as: "Category" }],
        },
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

    let scoredServices: Array<{ svc: any; score: number }>;
    try {
      const semanticHits = await rankSemanticCandidates(
        searchTerm,
        services.map((service: any) => ({
          id: service.id,
          text: [
            service.title,
            service.description,
            service.Subcategory?.title,
            service.Subcategory?.Category?.title,
            service.Professional?.description,
          ]
            .filter(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0,
            )
            .join(". "),
        })),
        { limit: 100 },
      );
      const serviceById = new Map(
        services.map((service: any) => [service.id, service]),
      );
      scoredServices = semanticHits
        .map((hit) => ({ svc: serviceById.get(hit.id), score: hit.score }))
        .filter((item): item is { svc: any; score: number } =>
          Boolean(item.svc),
        );
    } catch (error) {
      // O chatbot permanece utilizável durante uma indisponibilidade transitória
      // do modelo. O catálogo público informa explicitamente esse erro, mas este
      // fallback evita interromper um agendamento já iniciado.
      if (!(error instanceof SemanticSearchUnavailableError)) throw error;
      logger.warn(
        "Bot: busca semântica indisponível; usando compatibilidade textual",
        {
          userId,
        },
      );
      const normalizedSearch = normalizeText(searchTerm);
      const searchKeywords = normalizedSearch
        .split(" ")
        .filter((word) => word.length > 0);
      scoredServices = services
        .map((svc: any) => ({
          svc,
          score: calculateMatchScore(svc, normalizedSearch, searchKeywords),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);
    }

    if (scoredServices.length === 0) {
      return {
        reply: `Não encontrei serviços com o nome "${searchTerm}". Tente um termo diferente ou mais genérico (ex: "cabelo", "pintura"):`,
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          serviceOptions: undefined,
          serviceOptionsData: undefined,
        },
      };
    }

    const options = scoredServices.map(({ svc }) => buildServiceOption(svc));
    const choices = groupServiceOptions(options).slice(0, 6);
    const normalizedSearchTerm = normalizeText(searchTerm);
    const exactChoice = choices.find(
      (choice) => normalizeText(choice.title) === normalizedSearchTerm,
    );

    if (exactChoice || choices.length === 1) {
      return serviceChoiceResponse(exactChoice ?? choices[0]);
    }

    return {
      reply:
        `Encontrei estes tipos de serviço relacionados a "${searchTerm}":\n\n` +
        `${choices.map(serviceChoiceSummary).join("\n")}\n\n` +
        "Qual deles você quer agendar? Envie o número ou o nome do serviço.",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        serviceOptions: choices.map((choice) => choice.title),
        serviceOptionsData: undefined,
        serviceChoicesData: choices,
        pendingService: null,
      },
    };
  }
}

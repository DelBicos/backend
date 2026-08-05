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
  BotServiceOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { normalizeText, calculateMatchScore, findBestOptionMatch } from "../../../utils/nlp.util";
import { formatCurrency } from "../../../utils/format.util";

function buildServiceOption(service: any): BotServiceOption {
  const ratings = (service.Appointments ?? [])
    .map((appointment: AppointmentModel) => appointment.rating)
    .filter((rating: number | null | undefined): rating is number =>
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
    price:
      service.price_cents ?? Math.round(Number(service.price) * 100),
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

function selectionResponse(option: BotServiceOption): HandlerResult {
  const subcategoryName = option.subcategoryName ?? "Não informada";
  const rating =
    option.ratingsCount > 0
      ? `${option.rating.toFixed(1)} de 5 (${option.ratingsCount} ${
          option.ratingsCount === 1 ? "avaliação" : "avaliações"
        })`
      : "ainda sem avaliações neste serviço";

  return {
    reply:
      `Você escolheu "${option.title}" com ${option.professionalName}.\n\n` +
      `Subcategoria: ${subcategoryName}\n` +
      `Avaliação neste serviço: ${rating}\n` +
      `Valor: ${formatCurrency(option.price, undefined)}\n` +
      `Duração: ${option.duration} minutos\n\n` +
      "Agora informe a data desejada (ex.: 13/08, dia 13, 13 de agosto ou \"próxima segunda\").",
    nextState: "COLETANDO_DATA",
    contextUpdate: {
      serviceId: option.id,
      serviceName: option.title,
      serviceDescription: option.description,
      serviceSubcategoryId: option.subcategoryId,
      serviceSubcategoryName: subcategoryName,
      serviceCategoryName: option.categoryName,
      servicePrice: option.price,
      serviceDuration: option.duration,
      professionalId: option.professionalId,
      professionalName: option.professionalName,
      professionalAvatarUri: option.professionalAvatarUri,
      professionalRating: option.rating,
      professionalRatingsCount: option.ratingsCount,
      professionalCity: option.professionalCity,
      professionalState: option.professionalState,
      matchedServiceIds: [option.id],
      pendingService: null,
      serviceOptions: undefined,
      serviceOptionsData: undefined,
    },
  };
}

function optionSummary(option: BotServiceOption, index: number): string {
  const rating =
    option.ratingsCount > 0
      ? `⭐ ${option.rating.toFixed(1)} (${option.ratingsCount})`
      : "Novo neste serviço";
  const location =
    option.professionalCity && option.professionalState
      ? ` • ${option.professionalCity}/${option.professionalState}`
      : "";

  return (
    `${index + 1}. ${option.professionalName} — ${option.title}\n` +
    `   ${option.subcategoryName} • ${formatCurrency(option.price, undefined)} • ` +
    `${option.duration} min • ${rating}${location}`
  );
}

export class ColetandoServicoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;

    // 1. Se estamos aguardando confirmação do serviço selecionado
    if (ctx.pendingService) {
      const lower = userMessage.toLowerCase().trim();
      const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
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
          reply: "Ok, escolha cancelada. Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            pendingService: null,
            serviceOptions: undefined,
            serviceOptionsData: undefined,
          },
        };
      }

      return selectionResponse(ctx.pendingService);
    }

    // 2. Se há opções listadas, tenta selecionar por número ou por correspondência de texto
    if (ctx.serviceOptionsData && ctx.serviceOptionsData.length > 0) {
      const choice = parseInt(userMessage.trim(), 10);
      let picked = null;
      
      if (!isNaN(choice) && choice >= 1 && choice <= ctx.serviceOptionsData.length) {
        picked = ctx.serviceOptionsData[choice - 1];
      } else {
        // Tenta correspondência textual (ex: "Serv geral" correspondendo a "Serviços Gerais")
        picked = findBestOptionMatch(userMessage, ctx.serviceOptionsData);
        if (!picked) {
          const normalizedInput = normalizeText(userMessage);
          picked =
            ctx.serviceOptionsData.find((option) => {
              const professionalName = normalizeText(option.professionalName);
              return (
                professionalName === normalizedInput ||
                professionalName.includes(normalizedInput) ||
                normalizedInput.includes(professionalName)
              );
            }) ?? null;
        }
      }

      if (picked) return selectionResponse(picked);
    }

    // 3. Caso contrário, faz a busca pelo termo
    const searchTerm = nlu.entities.service ?? userMessage.trim();
    if (!searchTerm) {
      return {
        reply: "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
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

    const normalizedSearch = normalizeText(searchTerm);
    const searchKeywords = normalizedSearch.split(" ").filter(w => w.length > 0);

    const scoredServices = services
      .map((svc: any) => {
        const score = calculateMatchScore(svc, normalizedSearch, searchKeywords);
        return { svc, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

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
    const distinctServices = new Set(
      options.map(
        (option) => `${option.title}|${option.subcategoryName}`,
      ),
    );
    const heading =
      distinctServices.size === 1
        ? `Encontrei ${options.length} ${
            options.length === 1 ? "profissional" : "profissionais"
          } para "${options[0].title}", na subcategoria "${options[0].subcategoryName}".`
        : `Encontrei ${options.length} opções relacionadas a "${searchTerm}".`;

    return {
      reply:
        `${heading}\n\n` +
        `${options.map(optionSummary).join("\n\n")}\n\n` +
        "Escolha uma opção pelo cartão ou envie o número do profissional.",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        serviceOptions: options.map(
          (option) => `${option.title} — ${option.professionalName}`,
        ),
        serviceOptionsData: options,
        pendingService: null,
      },
    };
  }
}

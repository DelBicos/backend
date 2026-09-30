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
  stringSimilarity,
} from "../../../utils/nlp.util";
import {
  rankSemanticCandidates,
  SemanticSearchUnavailableError,
} from "../../semanticSearch.service";
import logger from "../../../utils/logger";
import {
  canonicalizeServiceToken,
  groupServiceOptions,
  migrateLegacyServiceOptions,
  normalizeServiceChoiceTitleKey,
} from "../serviceChoice.helpers";

import {
  analyzeServiceQuery,
  serviceSearchTokens,
  normalizeServiceSearchText,
} from "./servicoSearch/text";
import {
  filterStrongSemanticServices,
  findLexicalServiceAnchors,
  findLexicalServiceTitleAnchors,
  findServiceChoiceByName,
  semanticServiceGroupKey,
  serviceTitlesCoverQuery,
} from "./servicoSearch/ranking";
import {
  findUniqueTaxonomyMatch,
  loadActiveTaxonomy,
  servicesForTaxonomy,
} from "./servicoSearch/taxonomy";
import {
  buildServiceOption,
  clearedServiceSearchContext,
  serviceChoiceResponse,
  serviceChoiceSummary,
} from "./servicoSearch/choices";
import type { BotCatalogService, TaxonomyMatch } from "./servicoSearch/types";

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
      const trimmedMessage = userMessage.trim();
      const numericChoiceMatch = trimmedMessage.match(
        /^(?:op[cç][aã]o\s+)?(\d+)[.)]?$/i,
      );
      const looksLikeInvalidNumericChoice = /^\d+(?:\s*[/:.-]\s*\d+)+$/.test(
        trimmedMessage,
      );

      if (numericChoiceMatch) {
        const choice = Number(numericChoiceMatch[1]);
        if (choice >= 1 && choice <= ctx.serviceChoicesData.length) {
          return serviceChoiceResponse(ctx.serviceChoicesData[choice - 1]);
        }
      }

      if (numericChoiceMatch || looksLikeInvalidNumericChoice) {
        return {
          reply:
            "Não identifiquei essa opção. Escolha um dos serviços pelo número ou pelo nome:\n\n" +
            ctx.serviceChoicesData.map(serviceChoiceSummary).join("\n"),
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {},
        };
      }

      const picked = findServiceChoiceByName(
        trimmedMessage,
        ctx.serviceChoicesData,
      );
      if (picked) return serviceChoiceResponse(picked);

      // Um texto que não corresponde à lista anterior é uma nova busca de
      // serviço. Continuar o fluxo permite substituir opções obsoletas da sessão.
    }

    // 3. Caso contrário, faz a busca pelo termo
    const searchTerm = nlu.entities.service ?? userMessage.trim();
    if (!searchTerm) {
      return {
        reply:
          "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {},
        serviceSearchOutcome: "NOT_FOUND",
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

    const query = analyzeServiceQuery(searchTerm);
    const taxonomy = await loadActiveTaxonomy(services);
    const taxonomyMatch = findUniqueTaxonomyMatch(query.tokens, taxonomy);
    const lexicalServices = findLexicalServiceAnchors(query.tokens, services);
    const lexicalTitleServices = findLexicalServiceTitleAnchors(
      query.tokens,
      services,
    );
    const activeTitlesCoverFullQuery = serviceTitlesCoverQuery(
      query.tokens,
      lexicalTitleServices,
    );
    const fullTaxonomyMatch = taxonomyMatch?.match.coverage === 1;
    let matchSource: "lexical" | "taxonomy" | "semantic" | "textual" =
      "lexical";
    let canAdvanceAutomatically = false;
    let scoredServices: Array<{ svc: BotCatalogService; score: number }> = [];

    const applyTaxonomyMatch = (
      matchedTaxonomy: TaxonomyMatch,
    ): HandlerResult | null => {
      const taxonomyServices = servicesForTaxonomy(
        services,
        matchedTaxonomy.entry,
      );
      if (taxonomyServices.length === 0) {
        return {
          reply:
            `Entendi que você procura por "${matchedTaxonomy.entry.title}", ` +
            "mas ainda não há serviços disponíveis nessa categoria porque " +
            "nenhum profissional está oferecendo esse tipo de serviço. " +
            "Por favor, informe outro serviço que deseja agendar.",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: clearedServiceSearchContext(),
          serviceSearchOutcome: "UNAVAILABLE",
        };
      }

      matchSource = "taxonomy";
      canAdvanceAutomatically = true;
      scoredServices = taxonomyServices.map((svc) => ({ svc, score: 1 }));
      return null;
    };

    // Uma taxonomia completa tem precedência sobre coincidências parciais em
    // serviços ativos ("limpeza de sofá" não é limpeza doméstica). Somente
    // aliases explícitos de oferta ativa, como Montador/Montagem, furam essa
    // precedência.
    if (taxonomyMatch && fullTaxonomyMatch && !query.preferActiveService) {
      const taxonomyServices = servicesForTaxonomy(
        services,
        taxonomyMatch.entry,
      );
      if (taxonomyServices.length === 0 && activeTitlesCoverFullQuery) {
        // Alguns cadastros antigos possuem uma taxonomia vazia equivalente a
        // ofertas ativas em outra subcategoria (ex.: Pedicure Completa). Se
        // todos os termos buscados aparecem nos títulos ativos, use as ofertas
        // reais; uma palavra genérica isolada continua sem poder furar a regra.
        scoredServices = lexicalTitleServices;
        canAdvanceAutomatically = true;
      } else {
        const unavailable = applyTaxonomyMatch(taxonomyMatch);
        if (unavailable) return unavailable;
      }
    } else if (lexicalServices.length > 0) {
      scoredServices = lexicalServices;
      canAdvanceAutomatically = true;
    } else if (taxonomyMatch) {
      const unavailable = applyTaxonomyMatch(taxonomyMatch);
      if (unavailable) return unavailable;
    } else {
      try {
        const semanticHits = await rankSemanticCandidates(
          query.semanticQuery,
          services.map((service: BotCatalogService) => ({
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
          services.map((service: BotCatalogService) => [service.id, service]),
        );
        const rankedSemanticServices = semanticHits
          .map((hit) => ({ svc: serviceById.get(hit.id), score: hit.score }))
          .filter((item): item is { svc: BotCatalogService; score: number } =>
            Boolean(item.svc),
          );
        scoredServices = filterStrongSemanticServices(
          rankedSemanticServices,
          services,
        );
        matchSource = "semantic";
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
        const normalizedSearch = normalizeText(query.semanticQuery);
        const searchKeywords = normalizedSearch
          .split(" ")
          .filter((word) => word.length > 0);
        scoredServices = services
          .map((svc: BotCatalogService) => ({
            svc,
            score: calculateMatchScore(svc, normalizedSearch, searchKeywords),
          }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score);
        matchSource = "textual";
      }
    }

    if (scoredServices.length === 0) {
      return {
        reply:
          "Não consegui identificar um serviço disponível a partir dessa mensagem. " +
          'Informe somente o tipo de serviço que procura (ex.: "limpeza", "tomada" ou "montagem de móveis").',
        nextState: "COLETANDO_SERVICO",
        contextUpdate: clearedServiceSearchContext(),
        serviceSearchOutcome: "NOT_FOUND",
      };
    }

    const options = scoredServices.map(({ svc }) => buildServiceOption(svc));
    const choices = groupServiceOptions(options).slice(0, 6);
    const normalizedSearchTerm = normalizeText(searchTerm);
    const exactChoice = choices.find(
      (choice) => normalizeText(choice.title) === normalizedSearchTerm,
    );

    if (canAdvanceAutomatically && (exactChoice || choices.length === 1)) {
      return serviceChoiceResponse(exactChoice ?? choices[0]);
    }

    return {
      reply:
        `${
          matchSource === "semantic" || matchSource === "textual"
            ? "Encontrei estas opções possivelmente relacionadas"
            : "Encontrei estes tipos de serviço relacionados"
        } a "${searchTerm}":\n\n` +
        `${choices.map(serviceChoiceSummary).join("\n")}\n\n` +
        "Qual deles você quer agendar? Envie o número ou o nome do serviço.",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        serviceOptions: choices.map((choice) => choice.title),
        serviceOptionsData: undefined,
        serviceChoicesData: choices,
        pendingService: null,
      },
      serviceSearchOutcome: "MATCHED",
    };
  }
}

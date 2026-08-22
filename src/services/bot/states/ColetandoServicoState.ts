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
    serviceSearchOutcome: "MATCHED",
  };
}

function serviceChoiceSummary(choice: BotServiceChoice, index: number): string {
  const category = [choice.categoryName, choice.subcategoryName]
    .filter(Boolean)
    .join(" › ");
  return `${index + 1}. ${choice.title}${category ? ` — ${category}` : ""}`;
}

const SERVICE_SEARCH_STOP_WORDS = new Set([
  "a",
  "alguem",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "esta",
  "estou",
  "eu",
  "fazer",
  "favor",
  "gentileza",
  "gostaria",
  "aqui",
  "meu",
  "minha",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "porfavor",
  "pra",
  "preciso",
  "pfv",
  "que",
  "queria",
  "quero",
  "servico",
  "servicos",
  "um",
  "uma",
  "urgente",
]);

/**
 * Equivalências pequenas e específicas do catálogo. Elas cobrem formas
 * profissionais e erros comuns sem transformar qualquer prefixo parecido em
 * uma correspondência (por exemplo, "montanha" não é "montagem").
 */
const SERVICE_TOKEN_ALIASES = new Map<string, string>([
  ["barbeiro", "barba"],
  ["barbeiros", "barba"],
  ["jardineiro", "jardim"],
  ["jardineiros", "jardim"],
  ["jardineio", "jardim"],
  ["jardinagem", "jardim"],
  ["chaverio", "chaveiro"],
  ["faxineira", "diarista"],
  ["faxineiras", "diarista"],
  ["faxineiro", "diarista"],
  ["faxineiros", "diarista"],
  ["montagen", "montagem"],
  ["montador", "montagem"],
  ["montadores", "montagem"],
  ["montar", "montagem"],
  ["pintar", "pintor"],
  ["pintura", "pintor"],
  ["vidraca", "vidro"],
  ["vidracas", "vidro"],
  ["vazando", "vazamento"],
]);

const GENERIC_SERVICE_ACTION_TOKENS = new Set([
  "consertar",
  "conserto",
  "desentupidor",
  "desentupir",
  "instalacao",
  "instalar",
  "limpar",
  "limpeza",
  "manutencao",
  "montagem",
  "reformar",
  "reforma",
  "reparar",
  "reparo",
  "troca",
  "trocar",
]);

interface LexicalMatch {
  coverage: number;
  score: number;
}

interface RankedService {
  svc: any;
  score: number;
  coverage: number;
}

interface ActiveTaxonomy {
  kind: "subcategory" | "category";
  id: number;
  title: string;
  categoryId?: number;
  categoryTitle?: string;
}

interface ServiceQueryAnalysis {
  tokens: string[];
  semanticQuery: string;
  preferActiveService: boolean;
}

interface TaxonomyMatch {
  entry: ActiveTaxonomy;
  match: LexicalMatch;
}

function normalizeServiceSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalServiceToken(token: string): string {
  // "cabeleleiro" (erro relatado), "cabeleireiro", "cabelereiro" e
  // flexões de cabelo pertencem à mesma família. O prefixo completo "cabel"
  // evita confundir com "cabeamento".
  if (/^cabel/.test(token)) return "cabelo";
  return canonicalizeServiceToken(SERVICE_TOKEN_ALIASES.get(token) ?? token);
}

function serviceSearchTokens(value: string): string[] {
  return normalizeServiceSearchText(value)
    .split(" ")
    .filter(
      (token) => token.length > 0 && !SERVICE_SEARCH_STOP_WORDS.has(token),
    )
    .map(canonicalServiceToken);
}

function analyzeServiceQuery(value: string): ServiceQueryAnalysis {
  const normalized = normalizeServiceSearchText(value);
  const rawMeaningfulTokens = normalized
    .split(" ")
    .filter(
      (token) => token.length > 0 && !SERVICE_SEARCH_STOP_WORDS.has(token),
    );
  let tokens: string[] | null = null;
  let preferActiveService = false;

  if (
    rawMeaningfulTokens.length === 1 &&
    /^(?:montador(?:es)?|montagem|montagen)$/.test(rawMeaningfulTokens[0])
  ) {
    tokens = ["montagem"];
    preferActiveService = true;
  } else if (
    rawMeaningfulTokens.length === 1 &&
    /^desentup(?:idor|ir)$/.test(rawMeaningfulTokens[0])
  ) {
    tokens = ["desentupimento"];
    preferActiveService = true;
  } else if (
    /\b(?:montar|montagem|montagen|montador(?:es)?)\b.*\b(?:guarda\s*roupa|armario|movel|moveis)\b/.test(
      normalized,
    )
  ) {
    tokens = ["montagem", "movel"];
    preferActiveService = true;
  } else if (/\bdesentup(?:ir|idor)?\b.*\bpia\b/.test(normalized)) {
    tokens = ["desentupimento", "pia"];
    preferActiveService = true;
  } else if (/\bpia\b.*\bentupid[ao]s?\b/.test(normalized)) {
    tokens = ["desentupimento", "pia"];
  } else if (
    /\btorneira\b.*\bvaz\w*\b|\bvaz\w*\b.*\btorneira\b/.test(normalized)
  ) {
    tokens = ["vazamento"];
  } else if (
    /\b(?:faxina|faxineir[ao]s?|limpar|limpeza)\b.*\b(?:casa|residencia|apartamento)\b/.test(
      normalized,
    )
  ) {
    tokens = ["faxina"];
  } else if (
    /\b(?:cortar|aparar|podar|cuidar)\b.*\b(?:grama|jardim)\b/.test(normalized)
  ) {
    tokens = ["jardim"];
  } else if (
    /\b(?:abrir|destrancar)\b.*\b(?:porta|fechadura)\b|\bchave\b.*\b(?:presa|quebrada)\b|\bperd\w*\b.*\bchave\b.*\btranc\w*\b/.test(
      normalized,
    )
  ) {
    tokens = ["abertura", "fechadura"];
  } else if (/\b(?:limpar|limpeza)\b.*\bvidraca\b/.test(normalized)) {
    tokens = ["vidro"];
  } else if (/\bfazer\b.*\bunhas?\b/.test(normalized)) {
    tokens = ["manicure"];
  } else if (/\borganizar\b.*\b(armario|cozinha|ambiente)\b/.test(normalized)) {
    const target = normalized.match(
      /\borganizar\b.*\b(armario|cozinha|ambiente)\b/,
    )?.[1];
    tokens = ["organizacao", target ?? "ambiente"];
  } else if (/\bventilador\b.*\bteto\b/.test(normalized)) {
    tokens = ["ventilador"];
  } else if (/\bmanutencao\b.*\b(?:jardim|gas)\b/.test(normalized)) {
    const target = normalized.includes("jardim") ? "jardim" : "gas";
    tokens = ["manutencao", target];
  } else if (/\blimpeza\b.*\bpos\b.*\b(?:obra|reforma)\b/.test(normalized)) {
    tokens = ["limpeza", "pos", "reforma"];
  } else if (/\breforma\b.*\bbanheiro\b/.test(normalized)) {
    tokens = ["reforma", "banheiro"];
  }

  const baseTokens = tokens ?? serviceSearchTokens(value);
  const specificTokens = baseTokens.filter(
    (token) => !GENERIC_SERVICE_ACTION_TOKENS.has(token),
  );
  const effectiveTokens =
    tokens ?? (specificTokens.length > 0 ? specificTokens : baseTokens);

  return {
    tokens: effectiveTokens,
    semanticQuery: effectiveTokens.join(" ") || normalized,
    preferActiveService,
  };
}

function strongTokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;

  const similarity = stringSimilarity(left, right);
  return similarity >= 0.8 ? similarity : 0;
}

function calculateLexicalMatch(
  searchTokens: string[],
  candidateValues: Array<string | null | undefined>,
): LexicalMatch | null {
  if (searchTokens.length === 0) return null;

  const candidateTokens = Array.from(
    new Set(
      candidateValues.flatMap((value) =>
        typeof value === "string" ? serviceSearchTokens(value) : [],
      ),
    ),
  );
  if (candidateTokens.length === 0) return null;

  const tokenScores = searchTokens.map((searchToken) =>
    candidateTokens.reduce(
      (best, candidateToken) =>
        Math.max(best, strongTokenSimilarity(searchToken, candidateToken)),
      0,
    ),
  );
  const matchedScores = tokenScores.filter((score) => score > 0);
  if (matchedScores.length === 0) return null;

  const coverage = matchedScores.length / searchTokens.length;
  if (coverage < 0.5) return null;

  return {
    coverage,
    score:
      matchedScores.reduce((total, score) => total + score, 0) /
      matchedScores.length,
  };
}

function findLexicalServiceAnchors(
  searchTokens: string[],
  services: any[],
): RankedService[] {
  const ranked = services
    .map((svc): RankedService | null => {
      const match = calculateLexicalMatch(searchTokens, [
        svc.title,
        svc.Subcategory?.title,
        svc.Subcategory?.Category?.title,
      ]);
      return match ? { svc, ...match } : null;
    })
    .filter((item): item is RankedService => item !== null)
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.score - left.score ||
        left.svc.id - right.svc.id,
    );

  const best = ranked[0];
  if (!best) return [];

  // Uma palavra compartilhada não deve arrastar opções mais fracas quando
  // existe uma correspondência claramente mais completa para a consulta.
  return ranked.filter(
    (item) =>
      item.coverage === best.coverage && item.score >= best.score - 0.08,
  );
}

function findLexicalServiceTitleAnchors(
  searchTokens: string[],
  services: any[],
): RankedService[] {
  return services
    .map((svc): RankedService | null => {
      const match = calculateLexicalMatch(searchTokens, [svc.title]);
      return match ? { svc, ...match } : null;
    })
    .filter((item): item is RankedService => item !== null)
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.score - left.score ||
        left.svc.id - right.svc.id,
    );
}

function serviceTitlesCoverQuery(
  searchTokens: string[],
  titleMatches: RankedService[],
): boolean {
  return (
    searchTokens.length > 0 &&
    searchTokens.every((token) =>
      titleMatches.some(
        ({ svc }) =>
          calculateLexicalMatch([token], [svc.title])?.coverage === 1,
      ),
    )
  );
}

function findServiceChoiceByName(
  userInput: string,
  choices: BotServiceChoice[],
): BotServiceChoice | null {
  const normalizedInput = normalizeText(userInput);
  const exact = choices.find(
    (choice) => normalizeText(choice.title) === normalizedInput,
  );
  if (exact) return exact;

  const searchTokens = analyzeServiceQuery(userInput).tokens;
  if (searchTokens.length === 0) return null;

  const matches = choices.filter((choice) => {
    const match = calculateLexicalMatch(searchTokens, [choice.title]);
    return match?.coverage === 1;
  });

  // Termos parciais só selecionam quando identificam uma opção de forma
  // inequívoca. Caso contrário, o texto passa a ser uma nova busca.
  return matches.length === 1 ? matches[0] : null;
}

function taxonomyFromServices(services: any[]): ActiveTaxonomy[] {
  const entries = new Map<string, ActiveTaxonomy>();
  for (const service of services) {
    const subcategory = service.Subcategory;
    const category = subcategory?.Category;
    if (subcategory?.id != null) {
      entries.set(`subcategory:${subcategory.id}`, {
        kind: "subcategory",
        id: subcategory.id,
        title: subcategory.title,
        categoryId: category?.id,
        categoryTitle: category?.title,
      });
    }
    if (category?.id != null) {
      entries.set(`category:${category.id}`, {
        kind: "category",
        id: category.id,
        title: category.title,
      });
    }
  }
  return Array.from(entries.values());
}

async function loadActiveTaxonomy(services: any[]): Promise<ActiveTaxonomy[]> {
  // O guard mantém os testes/mocks antigos compatíveis. Em execução normal,
  // a taxonomia vem de uma consulta própria e inclui itens ainda sem serviços.
  const findSubcategories = (SubCategoryModel as any).findAll;
  const findCategories = (CategoryModel as any).findAll;
  if (typeof findSubcategories !== "function") {
    return taxonomyFromServices(services);
  }

  const [subcategories, categories] = await Promise.all([
    findSubcategories.call(SubCategoryModel, {
      where: { active: true },
      attributes: ["id", "title", "category_id"],
      include: [
        {
          model: CategoryModel,
          as: "Category",
          attributes: ["id", "title"],
          required: true,
          where: { active: true },
        },
      ],
    }),
    typeof findCategories === "function"
      ? findCategories.call(CategoryModel, {
          where: { active: true },
          attributes: ["id", "title"],
        })
      : Promise.resolve([]),
  ]);

  const entries = new Map<string, ActiveTaxonomy>();
  for (const subcategory of subcategories as any[]) {
    const category = subcategory.Category;
    entries.set(`subcategory:${subcategory.id}`, {
      kind: "subcategory",
      id: subcategory.id,
      title: subcategory.title,
      categoryId: category?.id ?? subcategory.category_id,
      categoryTitle: category?.title,
    });
    if (category?.id != null) {
      entries.set(`category:${category.id}`, {
        kind: "category",
        id: category.id,
        title: category.title,
      });
    }
  }
  for (const category of categories as any[]) {
    entries.set(`category:${category.id}`, {
      kind: "category",
      id: category.id,
      title: category.title,
    });
  }
  return Array.from(entries.values());
}

function findUniqueTaxonomyMatch(
  searchTokens: string[],
  taxonomy: ActiveTaxonomy[],
): TaxonomyMatch | null {
  const ranked = taxonomy
    .map((entry) => ({
      entry,
      match: calculateLexicalMatch(searchTokens, [entry.title]),
    }))
    .filter(
      (item): item is { entry: ActiveTaxonomy; match: LexicalMatch } =>
        item.match !== null,
    )
    .sort(
      (left, right) =>
        right.match.coverage - left.match.coverage ||
        right.match.score - left.match.score ||
        left.entry.title.localeCompare(right.entry.title),
    );

  const best = ranked[0];
  if (!best) return null;
  const competingMatches = ranked.filter(
    (item) =>
      item.match.coverage === best.match.coverage &&
      Math.abs(item.match.score - best.match.score) < 0.02,
  );
  return competingMatches.length === 1
    ? { entry: best.entry, match: best.match }
    : null;
}

function servicesForTaxonomy(services: any[], taxonomy: ActiveTaxonomy): any[] {
  if (taxonomy.kind === "subcategory") {
    return services.filter(
      (service) =>
        service.subcategory_id === taxonomy.id ||
        normalizeText(service.Subcategory?.title ?? "") ===
          normalizeText(taxonomy.title),
    );
  }

  return services.filter(
    (service) =>
      service.Subcategory?.Category?.id === taxonomy.id ||
      normalizeText(service.Subcategory?.Category?.title ?? "") ===
        normalizeText(taxonomy.title),
  );
}

function filterStrongSemanticServices(
  hits: Array<{ svc: any; score: number }>,
  allServices: any[],
): Array<{ svc: any; score: number }> {
  const groups = new Map<string, { key: string; score: number }>();

  for (const hit of hits) {
    const key = semanticServiceGroupKey(hit.svc);
    const current = groups.get(key);
    if (current) {
      current.score = Math.max(current.score, hit.score);
    } else {
      groups.set(key, { key, score: hit.score });
    }
  }

  const rankedGroups = Array.from(groups.values()).sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const best = rankedGroups[0];
  if (!best || best.score < 0.6) return [];

  const second = rankedGroups[1];
  if (second && best.score - second.score < 0.1) return [];

  const acceptedKeys = new Set(
    rankedGroups
      .filter((group) => group.score >= 0.6 && best.score - group.score <= 0.2)
      .map((group) => group.key),
  );
  const groupScore = new Map(
    rankedGroups.map((group) => [group.key, group.score]),
  );

  return allServices
    .filter((service) => acceptedKeys.has(semanticServiceGroupKey(service)))
    .map((svc) => ({
      svc,
      score: groupScore.get(semanticServiceGroupKey(svc)) ?? 0,
    }))
    .sort(
      (left, right) => right.score - left.score || left.svc.id - right.svc.id,
    );
}

function semanticServiceGroupKey(service: any): string {
  const subcategoryId =
    service.subcategory_id ?? service.Subcategory?.id ?? "sem-subcategoria";
  return `${normalizeServiceChoiceTitleKey(service.title)}|${subcategoryId}`;
}

function clearedServiceSearchContext(): Partial<BotSessionContext> {
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
    let scoredServices: Array<{ svc: any; score: number }> = [];

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
        const rankedSemanticServices = semanticHits
          .map((hit) => ({ svc: serviceById.get(hit.id), score: hit.score }))
          .filter((item): item is { svc: any; score: number } =>
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
          .map((svc: any) => ({
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
          `Não encontrei serviços nem profissionais relacionados a "${searchTerm}". ` +
          'Tente outro termo (ex.: "limpeza", "tomada" ou "montagem de móveis").',
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

/**
 * Casos de uso do catalogo de servicos oferecidos pelos profissionais (RF03).
 */
import { Op } from "sequelize";
import { sequelize } from "../../config/database";
import { ServiceModel } from "../../models/Service";
import { ServiceAvailabilityModel } from "../../models/ServiceAvailability";
import { ProfessionalModel } from "../../models/Professional";
import { SubCategoryModel } from "../../models/Subcategory";
import { UserModel } from "../../models/User";
import { AddressModel } from "../../models/Address";
import { CategoryModel } from "../../models/Category";
import { HttpError } from "../../errors/HttpError";
import { emitSSE } from "../../utils/sse";
import {
  rankSemanticCandidates,
  SEMANTIC_SEARCH_RESULT_LIMIT,
  SemanticSearchUnavailableError,
} from "../semanticSearch.service";
import {
  AvailabilityInput,
  CooldownTracker,
  normalizeAvailabilities,
  optionalPositiveId,
  parsePagination,
  parsePositiveId,
  resolvePrice,
  semanticDocument,
  toAvailabilityRows,
} from "./catalog.rules";

const CREATE_COOLDOWN_MS = 10_000;
const createCooldown = new CooldownTracker(CREATE_COOLDOWN_MS);

// ---------------------------------------------------------------------------
// Includes reutilizados
// ---------------------------------------------------------------------------

const AVAILABILITIES_INCLUDE = {
  model: ServiceAvailabilityModel,
  as: "Availabilities",
  attributes: ["id", "day_of_week", "start_time", "end_time"],
};

/** Dados publicos do profissional (sem e-mail/CPF). */
const PUBLIC_PROFESSIONAL_INCLUDE = {
  model: ProfessionalModel,
  as: "Professional",
  attributes: ["id", "user_id", "main_address_id", "description"],
  include: [
    { model: UserModel, as: "User", attributes: ["id", "name", "avatar_uri"] },
    { model: AddressModel, as: "MainAddress", attributes: ["city", "state"] },
  ],
};

const SUBCATEGORY_INCLUDE = {
  model: SubCategoryModel,
  as: "Subcategory",
  attributes: ["id", "title", "category_id"],
};

const SUBCATEGORY_WITH_CATEGORY_INCLUDE = {
  ...SUBCATEGORY_INCLUDE,
  include: [{ model: CategoryModel, as: "Category", attributes: ["id", "title"] }],
};

const DETAIL_INCLUDE = [SUBCATEGORY_INCLUDE, PUBLIC_PROFESSIONAL_INCLUDE, AVAILABILITIES_INCLUDE];

/** Serializa o servico com horarios normalizados (HH:MM). */
function present(service: any, extra: Record<string, unknown> = {}) {
  return {
    ...service.toJSON(),
    ...extra,
    Availabilities: normalizeAvailabilities(service.Availabilities ?? []),
  };
}

async function findDetailed(id: number) {
  const service = await ServiceModel.findByPk(id, { include: DETAIL_INCLUDE as any });
  if (!service) throw HttpError.notFound("Serviço não encontrado");
  return present(service);
}

// ---------------------------------------------------------------------------
// Autorizacao
// ---------------------------------------------------------------------------

async function requireProfessionalForUser(userId: number) {
  const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });
  if (!professional) {
    throw HttpError.forbidden(
      "Usuário não é um profissional. Crie um perfil profissional antes.",
    );
  }
  return professional;
}

async function requireOwnedService(serviceId: number, userId: number) {
  const service = await ServiceModel.findByPk(serviceId);
  if (!service) throw HttpError.notFound("Serviço não encontrado");
  const professional = await ProfessionalModel.findByPk(service.professional_id);
  if (!professional || professional.user_id !== userId) {
    throw HttpError.forbidden("Sem permissão para alterar serviços deste profissional");
  }
  return service;
}

/** A subcategoria precisa existir e pertencer a categoria (quando informada). */
async function resolveSubcategory(subcategoryId: unknown, categoryId?: unknown) {
  const sub = await SubCategoryModel.findByPk(parsePositiveId(subcategoryId, "subcategory_id"));
  if (!sub) throw HttpError.badRequest("subcategory_id não encontrada");
  if (categoryId !== undefined && categoryId !== null && sub.category_id !== Number(categoryId)) {
    throw HttpError.badRequest("subcategory_id não pertence à category_id informada");
  }
  return sub;
}

// ---------------------------------------------------------------------------
// Leitura publica
// ---------------------------------------------------------------------------

export async function listByProfessional(rawProfessionalId: unknown, query: any) {
  const professionalId = parsePositiveId(rawProfessionalId, "professionalId");
  const { limit, offset } = parsePagination(query.page, query.limit, {
    limit: 20,
    maxLimit: 100,
  });
  const rows = await ServiceModel.findAll({
    where: { professional_id: professionalId, active: true },
    include: [AVAILABILITIES_INCLUDE],
    limit,
    offset,
    order: [["title", "ASC"]],
  });
  return rows.map((s) => present(s));
}

/** Catalogo publico com filtros: category_id, subcategory_id, q, day, page, limit. */
export async function listPublic(query: any) {
  const { page, limit, offset } = parsePagination(query.page, query.limit, {
    limit: 20,
    maxLimit: 100,
  });

  const where: any = { active: true };
  const subcategoryId = optionalPositiveId(query.subcategory_id);
  if (subcategoryId) where.subcategory_id = subcategoryId;
  if (typeof query.q === "string" && query.q.trim()) {
    where.title = { [Op.like]: `%${query.q.trim()}%` };
  }

  const availabilityInclude: any = { ...AVAILABILITIES_INCLUDE, required: false };
  const day = Number(query.day);
  if (query.day !== undefined && Number.isInteger(day)) {
    availabilityInclude.where = { day_of_week: day };
    availabilityInclude.required = true;
  }

  const subcategoryInclude: any = { ...SUBCATEGORY_INCLUDE };
  const categoryId = optionalPositiveId(query.category_id);
  if (categoryId) subcategoryInclude.where = { category_id: categoryId };

  const professionalInclude = {
    ...PUBLIC_PROFESSIONAL_INCLUDE,
    attributes: ["id", "user_id", "description"],
  };

  const { count, rows } = await ServiceModel.findAndCountAll({
    where,
    include: [availabilityInclude, subcategoryInclude, professionalInclude],
    limit,
    offset,
    distinct: true,
    order: [["title", "ASC"]],
  });

  return { total: count, page, limit, data: rows.map((s) => present(s)) };
}

export async function getPublicById(rawId: unknown) {
  return findDetailed(parsePositiveId(rawId));
}

/**
 * Busca semantica: o banco filtra os candidatos (fonte de verdade) e o
 * nlp-service apenas ordena por similaridade.
 */
export async function searchSemantic(query: any) {
  const text = typeof query.q === "string" ? query.q.trim() : "";
  if (text.length < 2 || text.length > 500) {
    throw HttpError.badRequest("q deve ter entre 2 e 500 caracteres");
  }
  const { page, limit } = parsePagination(query.page, query.limit, { limit: 20, maxLimit: 50 });

  const where: any = { active: true };
  const subcategoryId = optionalPositiveId(query.subcategory_id);
  if (subcategoryId) where.subcategory_id = subcategoryId;

  const subcategoryInclude: any = { ...SUBCATEGORY_WITH_CATEGORY_INCLUDE };
  const categoryId = optionalPositiveId(query.category_id);
  if (categoryId) {
    subcategoryInclude.where = { category_id: categoryId };
    subcategoryInclude.required = true;
  }

  const availabilityInclude: any = {
    model: ServiceAvailabilityModel,
    as: "Availabilities",
    attributes: [],
    required: false,
  };
  if (query.day !== undefined) {
    const day = Number(query.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw HttpError.badRequest("day deve ser um número entre 0 e 6");
    }
    availabilityInclude.where = { day_of_week: day };
    availabilityInclude.required = true;
  }

  const candidates = await ServiceModel.findAll({
    where,
    attributes: ["id", "title", "description"],
    include: [subcategoryInclude, availabilityInclude],
    order: [["id", "ASC"]],
  });

  const emptyResult = (total: number, resultsLimited: boolean) => ({
    total,
    candidate_total: candidates.length,
    page,
    limit,
    has_more: false,
    results_limited: resultsLimited,
    data: [] as unknown[],
  });
  if (candidates.length === 0) return emptyResult(0, false);

  // Janela fixa de melhores resultados: o "total" nao muda entre paginas.
  const rankingLimit = SEMANTIC_SEARCH_RESULT_LIMIT;
  let hits;
  try {
    hits = await rankSemanticCandidates(
      text,
      candidates.map((service: any) => ({ id: service.id, text: semanticDocument(service) })),
      { limit: rankingLimit },
    );
  } catch (error) {
    if (error instanceof SemanticSearchUnavailableError) {
      throw new HttpError(503, "Busca semântica temporariamente indisponível. Tente novamente.");
    }
    throw error;
  }

  const total = hits.length;
  const resultsLimited = hits.length === rankingLimit && rankingLimit < candidates.length;
  const pageHits = hits.slice((page - 1) * limit, page * limit);
  if (pageHits.length === 0) return emptyResult(total, resultsLimited);

  const services = await ServiceModel.findAll({
    where: { id: { [Op.in]: pageHits.map((hit) => hit.id) }, active: true },
    include: [
      AVAILABILITIES_INCLUDE,
      SUBCATEGORY_WITH_CATEGORY_INCLUDE,
      { ...PUBLIC_PROFESSIONAL_INCLUDE, attributes: ["id", "user_id", "description"] },
    ],
  });
  const serviceById = new Map(services.map((service: any) => [service.id, service]));

  const data = pageHits.flatMap((hit) => {
    const service = serviceById.get(hit.id);
    return service ? [present(service, { relevance_score: hit.score })] : [];
  });

  return {
    total,
    candidate_total: candidates.length,
    page,
    limit,
    has_more: page * limit < total,
    results_limited: resultsLimited,
    data,
  };
}

// ---------------------------------------------------------------------------
// Gestao pelo profissional
// ---------------------------------------------------------------------------

export interface ServiceInput {
  title?: unknown;
  description?: unknown;
  price?: unknown;
  price_cents?: unknown;
  duration?: unknown;
  date?: unknown;
  banner_uri?: unknown;
  category_id?: unknown;
  subcategory_id?: unknown;
  active?: unknown;
  availabilities?: AvailabilityInput[];
}

/**
 * Cria um servico para o profissional do usuario autenticado.
 * `professionalId` (rota legada) precisa ser o do proprio usuario.
 */
export async function createForUser(
  userId: number,
  input: ServiceInput,
  options: { professionalId?: unknown } = {},
) {
  const professional = await requireProfessionalForUser(userId);
  if (
    options.professionalId !== undefined &&
    parsePositiveId(options.professionalId, "professionalId") !== professional.id
  ) {
    throw HttpError.forbidden("Sem permissão para criar serviços neste profissional");
  }

  const wait = createCooldown.hit(professional.id);
  if (wait > 0) {
    throw new HttpError(429, `Aguarde ${wait}s antes de criar outro serviço.`);
  }

  const subcategory = await resolveSubcategory(input.subcategory_id, input.category_id);
  const price = resolvePrice(input);
  if (!price) throw HttpError.badRequest("price ou price_cents é obrigatório e deve ser >= 0");

  const created = await sequelize.transaction(async (transaction) => {
    const service = await ServiceModel.create(
      {
        title: String(input.title).trim(),
        description: input.description ? String(input.description).trim() : undefined,
        ...price,
        duration: Number(input.duration ?? 60),
        date: input.date ? new Date(String(input.date)) : undefined,
        banner_uri: input.banner_uri ? String(input.banner_uri) : undefined,
        active: true,
        category_id: subcategory.category_id,
        subcategory_id: subcategory.id,
        professional_id: professional.id,
      },
      { transaction },
    );
    if (Array.isArray(input.availabilities) && input.availabilities.length > 0) {
      await ServiceAvailabilityModel.bulkCreate(
        toAvailabilityRows(service.id, input.availabilities),
        { transaction },
      );
    }
    return service;
  });

  const json = await findDetailed(created.id);
  emitSSE("services", "new_service", {
    id: json.id,
    title: json.title,
    price: json.price,
    category_id: json.category_id,
    subcategory_id: json.subcategory_id,
    professional_id: json.professional_id,
  });
  return json;
}

const UPDATABLE_FIELDS = [
  "title",
  "description",
  "duration",
  "date",
  "banner_uri",
  "active",
] as const;

/** Atualiza um servico do proprio profissional (substitui a disponibilidade, se enviada). */
export async function updateForUser(userId: number, rawId: unknown, input: ServiceInput) {
  const id = parsePositiveId(rawId);
  const service = await requireOwnedService(id, userId);

  const changes: Record<string, unknown> = {};
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) changes[key] = input[key];
  }
  Object.assign(changes, resolvePrice(input) ?? {});

  if (input.subcategory_id !== undefined || input.category_id !== undefined) {
    const subcategory = await resolveSubcategory(
      input.subcategory_id ?? service.subcategory_id,
      input.category_id,
    );
    changes.subcategory_id = subcategory.id;
    changes.category_id = subcategory.category_id;
  }

  await sequelize.transaction(async (transaction) => {
    await service.update(changes, { transaction });
    if (Array.isArray(input.availabilities)) {
      await ServiceAvailabilityModel.destroy({ where: { service_id: id }, transaction });
      if (input.availabilities.length > 0) {
        await ServiceAvailabilityModel.bulkCreate(toAvailabilityRows(id, input.availabilities), {
          transaction,
        });
      }
    }
  });

  return findDetailed(id);
}

/** Todos os servicos (ativos e inativos) do profissional autenticado. */
export async function listForUser(userId: number, query: any) {
  const professional = await requireProfessionalForUser(userId);
  const { page, limit, offset } = parsePagination(query.page, query.limit, {
    limit: 50,
    maxLimit: 100,
  });
  const { count, rows } = await ServiceModel.findAndCountAll({
    where: { professional_id: professional.id },
    include: [AVAILABILITIES_INCLUDE, SUBCATEGORY_INCLUDE],
    limit,
    offset,
    distinct: true,
    order: [["title", "ASC"]],
  });
  return { total: count, page, limit, data: rows.map((s) => present(s)) };
}

/** Soft delete: o servico deixa de aparecer, mas o historico e preservado. */
export async function deactivateForUser(userId: number, rawId: unknown) {
  const service = await requireOwnedService(parsePositiveId(rawId), userId);
  service.active = false;
  await service.save();
}

import { Request, Response } from "express";
import { Op } from "sequelize";
import { sequelize } from "../config/database";
import { emitSSE } from "../utils/sse";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { ServiceModel } from "../models/Service";
import { ServiceAvailabilityModel } from "../models/ServiceAvailability";
import { ProfessionalModel } from "../models/Professional";
import { SubCategoryModel } from "../models/Subcategory";
import { UserModel } from "../models/User";
import { AddressModel } from "../models/Address";
import { CategoryModel } from "../models/Category";
import {
  rankSemanticCandidates,
  SEMANTIC_SEARCH_RESULT_LIMIT,
  SemanticSearchUnavailableError,
} from "../services/semanticSearch.service";

// ─── rate-limit em memória (criação de serviço por profissional) ─────────────────
const CREATE_RATE_WINDOW_MS = 10_000; // 10 segundos
const createRateMap = new Map<number, number>(); // professional_id → timestamp ms

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Normaliza TIME retornado pelo banco para HH:MM */
function normalizeTime(t: string): string {
  if (!t) return t;
  // banco pode retornar "09:00:00" — manter apenas HH:MM
  return t.slice(0, 5);
}

function normalizeAvailabilities(avs: ServiceAvailabilityModel[]) {
  return avs.map((a) => ({
    id: a.id,
    day_of_week: a.day_of_week,
    start_time: normalizeTime(a.start_time),
    end_time: normalizeTime(a.end_time),
  }));
}

async function findServiceWithOwnership(
  serviceId: number,
  userId: number,
  res: Response,
): Promise<InstanceType<typeof ServiceModel> | null> {
  const service = await ServiceModel.findByPk(serviceId);
  if (!service) {
    res.status(404).json({ error: "Serviço não encontrado" });
    return null;
  }
  const professional = await ProfessionalModel.findByPk(
    service.professional_id,
  );
  if (!professional || professional.user_id !== userId) {
    res.status(403).json({
      error: "Sem permissão para alterar serviços deste profissional",
    });
    return null;
  }
  return service;
}

/** Inclui na query padrão de listagem: Subcategory, Professional (com User e Address) e Availabilities */
const DEFAULT_SERVICE_INCLUDE = [
  {
    model: SubCategoryModel,
    as: "Subcategory",
    attributes: ["id", "title", "category_id"],
  },
  {
    model: ProfessionalModel,
    as: "Professional",
    attributes: ["id", "user_id", "main_address_id", "description"],
    include: [
      {
        model: UserModel,
        as: "User",
        attributes: ["id", "name", "email", "avatar_uri"],
      },
      {
        model: AddressModel,
        as: "MainAddress",
        attributes: ["city", "state"],
      },
    ],
  },
  {
    model: ServiceAvailabilityModel,
    as: "Availabilities",
    attributes: ["id", "day_of_week", "start_time", "end_time"],
  },
];

// ─── controllers ──────────────────────────────────────────────────────────────

// GET /api/professionals/:professionalId/services
export const listServices = async (req: Request, res: Response) => {
  try {
    const professionalId = Number(req.params.professionalId);
    if (!Number.isInteger(professionalId) || professionalId <= 0)
      return res.status(400).json({ error: "professionalId inválido" });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const rows = await ServiceModel.findAll({
      where: { professional_id: professionalId, active: true },
      include: [
        {
          model: ServiceAvailabilityModel,
          as: "Availabilities",
          attributes: ["id", "day_of_week", "start_time", "end_time"],
        },
      ],
      limit,
      offset,
      order: [["title", "ASC"]],
    });

    const result = rows.map((s: any) => ({
      ...s.toJSON(),
      Availabilities: normalizeAvailabilities(s.Availabilities ?? []),
    }));

    return res.json(result);
  } catch (error: any) {
    console.error("Erro listServices:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * GET /api/services
 * Query params: category_id, subcategory_id, q (busca por título), day (0-6), page, limit
 */
export const listAllServices = async (req: Request, res: Response) => {
  try {
    const {
      category_id,
      subcategory_id,
      q,
      day,
      page: pageRaw = 1,
      limit: limitRaw = 20,
    } = req.query as any;

    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20));
    const offset = (page - 1) * limit;

    const where: any = { active: true };

    if (subcategory_id && Number.isInteger(Number(subcategory_id)))
      where.subcategory_id = Number(subcategory_id);

    if (q && typeof q === "string" && q.trim().length > 0)
      where.title = { [Op.like]: `%${q.trim()}%` };

    // filtro por day de disponibilidade (join condicional)
    const avInclude: any = {
      model: ServiceAvailabilityModel,
      as: "Availabilities",
      attributes: ["id", "day_of_week", "start_time", "end_time"],
      required: false,
    };
    if (day !== undefined && Number.isInteger(Number(day))) {
      avInclude.where = { day_of_week: Number(day) };
      avInclude.required = true;
    }

    const subInclude: any = {
      model: SubCategoryModel,
      as: "Subcategory",
      attributes: ["id", "title", "category_id"],
    };
    if (category_id && Number.isInteger(Number(category_id))) {
      subInclude.where = { category_id: Number(category_id) };
    }

    const { count, rows } = await ServiceModel.findAndCountAll({
      where,
      include: [
        avInclude,
        subInclude,
        {
          model: ProfessionalModel,
          as: "Professional",
          attributes: ["id", "user_id", "description"],
          include: [
            {
              model: UserModel,
              as: "User",
              attributes: ["id", "name", "avatar_uri"],
            },
            {
              model: AddressModel,
              as: "MainAddress",
              attributes: ["city", "state"],
            },
          ],
        },
      ],
      limit,
      offset,
      distinct: true,
      order: [["title", "ASC"]],
    });

    const data = rows.map((s: any) => ({
      ...s.toJSON(),
      Availabilities: normalizeAvailabilities(s.Availabilities ?? []),
    }));

    return res.json({ total: count, page, limit, data });
  } catch (error: any) {
    console.error("Erro listAllServices:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * GET /api/services/search/semantic
 * Query params: q, category_id, subcategory_id, day, page, limit
 *
 * A consulta ao banco continua sendo a fonte de verdade. Apenas o ranking é
 * delegado ao nlp-service, que recebe documentos já filtrados e devolve IDs.
 */
export const searchServicesSemantically = async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2 || query.length > 500) {
    return res.status(400).json({ error: "q deve ter entre 2 e 500 caracteres" });
  }

  const requestedPage = Number(req.query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(50, requestedLimit)
    : 20;
  const categoryId = Number(req.query.category_id);
  const subcategoryId = Number(req.query.subcategory_id);
  const day = Number(req.query.day);

  try {
    const where: any = { active: true };
    if (Number.isInteger(subcategoryId) && subcategoryId > 0) {
      where.subcategory_id = subcategoryId;
    }

    const subcategoryInclude: any = {
      model: SubCategoryModel,
      as: "Subcategory",
      attributes: ["id", "title", "category_id"],
      include: [
        {
          model: CategoryModel,
          as: "Category",
          attributes: ["id", "title"],
        },
      ],
    };
    if (Number.isInteger(categoryId) && categoryId > 0) {
      subcategoryInclude.where = { category_id: categoryId };
      subcategoryInclude.required = true;
    }

    const availabilityInclude: any = {
      model: ServiceAvailabilityModel,
      as: "Availabilities",
      attributes: [],
      required: false,
    };
    if (req.query.day !== undefined) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: "day deve ser um número entre 0 e 6" });
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

    if (candidates.length === 0) {
      return res.json({
        total: 0,
        candidate_total: 0,
        page,
        limit,
        has_more: false,
        results_limited: false,
        data: [],
      });
    }

    // A paginação é estável dentro da janela de melhores resultados definida
    // para a busca semântica; não variar esse limite por página evita que o
    // campo `total` mude enquanto o cliente navega pelos resultados.
    const rankingLimit = SEMANTIC_SEARCH_RESULT_LIMIT;
    let hits;
    try {
      hits = await rankSemanticCandidates(
        query,
        candidates.map((service: any) => ({
          id: service.id,
          text: [
            service.title,
            service.description,
            service.Subcategory?.title,
            service.Subcategory?.Category?.title,
          ]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .join(". "),
        })),
        { limit: rankingLimit },
      );
    } catch (error) {
      if (error instanceof SemanticSearchUnavailableError) {
        return res.status(503).json({
          error: "Busca semântica temporariamente indisponível. Tente novamente.",
        });
      }
      throw error;
    }

    const total = hits.length;
    const pageHits = hits.slice((page - 1) * limit, page * limit);
    if (pageHits.length === 0) {
      return res.json({
        total,
        candidate_total: candidates.length,
        page,
        limit,
        has_more: false,
        results_limited: hits.length === rankingLimit && rankingLimit < candidates.length,
        data: [],
      });
    }

    const services = await ServiceModel.findAll({
      where: { id: { [Op.in]: pageHits.map((hit) => hit.id) }, active: true },
      include: [
        {
          model: ServiceAvailabilityModel,
          as: "Availabilities",
          attributes: ["id", "day_of_week", "start_time", "end_time"],
        },
        {
          model: SubCategoryModel,
          as: "Subcategory",
          attributes: ["id", "title", "category_id"],
          include: [{ model: CategoryModel, as: "Category", attributes: ["id", "title"] }],
        },
        {
          model: ProfessionalModel,
          as: "Professional",
          attributes: ["id", "user_id", "description"],
          include: [
            {
              model: UserModel,
              as: "User",
              attributes: ["id", "name", "avatar_uri"],
            },
            {
              model: AddressModel,
              as: "MainAddress",
              attributes: ["city", "state"],
            },
          ],
        },
      ],
    });
    const serviceById = new Map(services.map((service: any) => [service.id, service]));
    const scoreById = new Map(hits.map((hit) => [hit.id, hit.score]));
    const data = pageHits.flatMap((hit) => {
      const service: any = serviceById.get(hit.id);
      if (!service) return [];
      return [
        {
          ...service.toJSON(),
          relevance_score: scoreById.get(hit.id),
          Availabilities: normalizeAvailabilities(service.Availabilities ?? []),
        },
      ];
    });

    return res.json({
      total,
      candidate_total: candidates.length,
      page,
      limit,
      has_more: page * limit < total,
      results_limited: hits.length === rankingLimit && rankingLimit < candidates.length,
      data,
    });
  } catch (error) {
    console.error("Erro searchServicesSemantically:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// GET /api/services/:id
export const getService = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const service = await ServiceModel.findByPk(id, {
      include: DEFAULT_SERVICE_INCLUDE as any,
    });
    if (!service)
      return res.status(404).json({ error: "Serviço não encontrado" });

    const json: any = service.toJSON();
    json.Availabilities = normalizeAvailabilities(
      (service as any).Availabilities ?? [],
    );
    return res.json(json);
  } catch (error: any) {
    console.error("Erro getService:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * POST /api/services (top-level, deriva professional_id do token)
 * Body: { title, description, price, category_id, subcategory_id, duration?, availabilities? }
 */
export const createServiceSelf = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<any> => {
  try {
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });

    const professional = await ProfessionalModel.findOne({
      where: { user_id: req.user.id },
    });
    if (!professional)
      return res.status(403).json({
        error:
          "Usuário não é um profissional. Crie um perfil profissional antes.",
      });

    // Rate-limit: bloqueia envio duplicado dentro da janela de 10 s
    const now = Date.now();
    const lastAt = createRateMap.get(professional.id);
    if (lastAt && now - lastAt < CREATE_RATE_WINDOW_MS) {
      const waitSec = Math.ceil(
        (CREATE_RATE_WINDOW_MS - (now - lastAt)) / 1000,
      );
      return res.status(429).json({
        error: `Aguarde ${waitSec}s antes de criar outro serviço.`,
      });
    }
    createRateMap.set(professional.id, now);

    const {
      title,
      description,
      price,
      category_id,
      subcategory_id,
      duration = 60,
      banner_uri,
      availabilities,
    } = req.body;

    // Validar que subcategoria pertence à categoria
    const subcategory = await SubCategoryModel.findByPk(Number(subcategory_id));
    if (!subcategory)
      return res.status(400).json({ error: "subcategory_id não encontrada" });
    if (subcategory.category_id !== Number(category_id))
      return res.status(400).json({
        error: "subcategory_id não pertence à category_id informada",
      });

    // Aceitar price (float) OU price_cents (inteiro) — compatibilidade
    const { price_cents: rawPriceCents } = req.body;
    let resolvedPrice: number;
    let priceCents: number;
    if (rawPriceCents !== undefined && rawPriceCents !== null) {
      priceCents = Math.round(Number(rawPriceCents));
      resolvedPrice = priceCents / 100;
    } else {
      resolvedPrice = Number(price);
      priceCents = Math.round(resolvedPrice * 100);
    }

    const t = await sequelize.transaction();
    let newService: InstanceType<typeof ServiceModel>;
    try {
      newService = await ServiceModel.create(
        {
          title: String(title).trim(),
          description: description ? String(description).trim() : undefined,
          price: resolvedPrice,
          price_cents: priceCents,
          duration: Number(duration),
          banner_uri: banner_uri || undefined,
          active: true,
          category_id: Number(category_id),
          subcategory_id: Number(subcategory_id),
          professional_id: professional.id,
        },
        { transaction: t },
      );

      // Criar availabilities se informadas — mesma transação
      if (Array.isArray(availabilities) && availabilities.length > 0) {
        await ServiceAvailabilityModel.bulkCreate(
          availabilities.map((a: any) => ({
            service_id: newService.id,
            day_of_week: Number(a.day),
            start_time: a.start,
            end_time: a.end,
          })),
          { transaction: t },
        );
      }

      await t.commit();
    } catch (txErr) {
      await t.rollback();
      throw txErr;
    }

    // Buscar com associações para retornar objeto completo
    const result = await ServiceModel.findByPk(newService.id, {
      include: DEFAULT_SERVICE_INCLUDE as any,
    });

    const json: any = result!.toJSON();
    json.Availabilities = normalizeAvailabilities(
      (result as any).Availabilities ?? [],
    );

    // Notifica clientes SSE sobre novo serviço disponível
    emitSSE("services", "new_service", {
      id: json.id,
      title: json.title,
      price: json.price,
      category_id: json.category_id,
      subcategory_id: json.subcategory_id,
      professional_id: json.professional_id,
    });
    return res.status(201).json({ service: json });
  } catch (error: any) {
    console.error("Erro createServiceSelf:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// POST /api/professionals/:professionalId/services (rota legada, mantida)
export const createService = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const professionalId = Number(req.params.professionalId);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(professionalId) || professionalId <= 0)
      return res.status(400).json({ error: "professionalId inválido" });

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });
    if (professional.user_id !== req.user.id)
      return res.status(403).json({
        error: "Sem permissão para criar serviços neste profissional",
      });

    const {
      title,
      description,
      price,
      price_cents,
      duration,
      date,
      banner_uri,
      subcategory_id,
      category_id,
      availabilities,
    } = req.body;

    const finalPriceCents =
      price_cents !== undefined
        ? Number(price_cents)
        : price !== undefined
          ? Math.round(Number(price) * 100)
          : undefined;
    const finalPrice =
      finalPriceCents !== undefined ? finalPriceCents / 100 : Number(price);

    const created = await ServiceModel.create({
      title,
      description,
      price: finalPrice,
      price_cents: finalPriceCents,
      duration: Number(duration),
      date: date ? new Date(date) : undefined,
      banner_uri,
      active: true,
      category_id: category_id ? Number(category_id) : undefined,
      subcategory_id: Number(subcategory_id),
      professional_id: professionalId,
    });

    if (Array.isArray(availabilities) && availabilities.length > 0) {
      await ServiceAvailabilityModel.bulkCreate(
        availabilities.map((a: any) => ({
          service_id: created.id,
          day_of_week: Number(a.day),
          start_time: a.start,
          end_time: a.end,
        })),
      );
    }

    const result = await ServiceModel.findByPk(created.id, {
      include: [
        {
          model: ServiceAvailabilityModel,
          as: "Availabilities",
          attributes: ["id", "day_of_week", "start_time", "end_time"],
        },
      ],
    });
    return res.status(201).json(result);
  } catch (error: any) {
    console.error("Erro createService:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// PUT /api/services/:id
export const updateService = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const service = await findServiceWithOwnership(id, req.user.id, res);
    if (!service) return;

    const updatable = [
      "title",
      "description",
      "price",
      "price_cents",
      "duration",
      "date",
      "banner_uri",
      "subcategory_id",
      "category_id",
      "active",
    ] as const;
    for (const key of updatable) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        // @ts-ignore
        service[key] = req.body[key];
      }
    }

    // Sincronizar price <-> price_cents
    if (req.body.price_cents !== undefined) {
      service.price = Number(req.body.price_cents) / 100;
      service.price_cents = Number(req.body.price_cents);
    } else if (req.body.price !== undefined) {
      service.price_cents = Math.round(Number(req.body.price) * 100);
      service.price = Number(req.body.price);
    }

    // Validar category/subcategory se ambos informados
    if (
      req.body.category_id !== undefined &&
      req.body.subcategory_id !== undefined
    ) {
      const sub = await SubCategoryModel.findByPk(
        Number(req.body.subcategory_id),
      );
      if (!sub)
        return res.status(400).json({ error: "subcategory_id não encontrada" });
      if (sub.category_id !== Number(req.body.category_id))
        return res.status(400).json({
          error: "subcategory_id não pertence à category_id informada",
        });
    }

    await service.save();

    // Substituir availabilities se informadas
    if (
      Object.prototype.hasOwnProperty.call(req.body, "availabilities") &&
      Array.isArray(req.body.availabilities)
    ) {
      await ServiceAvailabilityModel.destroy({ where: { service_id: id } });
      if (req.body.availabilities.length > 0) {
        await ServiceAvailabilityModel.bulkCreate(
          req.body.availabilities.map((a: any) => ({
            service_id: id,
            day_of_week: Number(a.day),
            start_time: a.start,
            end_time: a.end,
          })),
        );
      }
    }

    const result = await ServiceModel.findByPk(id, {
      include: DEFAULT_SERVICE_INCLUDE as any,
    });
    const json: any = result!.toJSON();
    json.Availabilities = normalizeAvailabilities(
      (result as any).Availabilities ?? [],
    );
    return res.json(json);
  } catch (error: any) {
    console.error("Erro updateService:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * GET /api/services/my — lista todos os serviços (ativos e inativos) do profissional autenticado
 */
export const listMyServices = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<any> => {
  try {
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });

    const professional = await ProfessionalModel.findOne({
      where: { user_id: req.user.id },
    });
    if (!professional)
      return res.status(403).json({
        error: "Usuário não é um profissional.",
      });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const { count, rows } = await ServiceModel.findAndCountAll({
      where: { professional_id: professional.id },
      include: [
        {
          model: ServiceAvailabilityModel,
          as: "Availabilities",
          attributes: ["id", "day_of_week", "start_time", "end_time"],
        },
        {
          model: SubCategoryModel,
          as: "Subcategory",
          attributes: ["id", "title", "category_id"],
        },
      ],
      limit,
      offset,
      distinct: true,
      order: [["title", "ASC"]],
    });

    const data = rows.map((s: any) => ({
      ...s.toJSON(),
      Availabilities: normalizeAvailabilities(s.Availabilities ?? []),
    }));

    return res.json({ total: count, page, limit, data });
  } catch (error: any) {
    console.error("Erro listMyServices:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// DELETE /api/services/:id  (soft delete via active=false)
export const deleteService = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const service = await findServiceWithOwnership(id, req.user.id, res);
    if (!service) return;

    service.active = false;
    await service.save();
    return res.status(204).send();
  } catch (error: any) {
    console.error("Erro deleteService:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

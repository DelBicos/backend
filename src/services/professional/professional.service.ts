/**
 * Casos de uso do perfil profissional: busca publica, perfil, disponibilidade,
 * cadastro (RF02) e raio de atuacao (RF04).
 */
import { Op, UniqueConstraintError, literal } from "sequelize";
import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import { AddressModel } from "../../models/Address";
import { ServiceModel } from "../../models/Service";
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { HttpError } from "../../errors/HttpError";
import { distanceKm } from "../../utils/geo.util";
import { getAvailableSlots } from "../availability.service";
import { parsePositiveId } from "../catalog/catalog.rules";
import {
  averageRating,
  parseDescription,
  parseDocuments,
  parseIsoDate,
  parseOptionalCoordinate,
  parseRadiusKm,
} from "./professional.rules";

/** Atributos do profissional seguros para exibicao publica (sem CPF/CNPJ). */
const PUBLIC_PROFESSIONAL_ATTRIBUTES = [
  "id",
  "user_id",
  "main_address_id",
  "description",
  "service_radius_km",
  "createdAt",
  "updatedAt",
];

/** Local de atendimento exibido no perfil publico (sem ids internos). */
const PUBLIC_ADDRESS_ATTRIBUTES = [
  "street",
  "number",
  "complement",
  "neighborhood",
  "city",
  "state",
  "postal_code",
  "lat",
  "lng",
];

const COMPLETED_WITH_RATING = { status: "completed", rating: { [Op.not]: null } };

/** Mapa professional_id -> notas, com uma unica consulta. */
async function ratingsByProfessional(professionalIds: number[]) {
  const map = new Map<number, number[]>();
  if (professionalIds.length === 0) return map;
  const rows = await AppointmentModel.findAll({
    where: { professional_id: { [Op.in]: professionalIds }, ...COMPLETED_WITH_RATING },
    attributes: ["professional_id", "rating"],
    raw: true,
  });
  for (const row of rows as any[]) {
    const list = map.get(row.professional_id) ?? [];
    list.push(row.rating);
    map.set(row.professional_id, list);
  }
  return map;
}

async function requireOwnProfessional(userId: number, rawId: unknown, action: string) {
  const professional = await ProfessionalModel.findByPk(
    parsePositiveId(rawId, "ID do profissional"),
  );
  if (!professional) throw HttpError.notFound("Profissional não encontrado");
  if (professional.user_id !== userId) {
    throw HttpError.forbidden(`Não autorizado a ${action} este profissional`);
  }
  return professional;
}

async function findWithRelations(id: number) {
  return ProfessionalModel.findByPk(id, {
    attributes: PUBLIC_PROFESSIONAL_ATTRIBUTES,
    include: [
      { model: UserModel, as: "User", attributes: ["id", "name", "avatar_uri", "banner_uri"] },
      { model: AddressModel, as: "MainAddress", attributes: ["id", "city", "state", "lat", "lng"] },
    ],
  });
}

// ---------------------------------------------------------------------------
// Leitura publica
// ---------------------------------------------------------------------------

/** Lista paginada (page 0-based) com busca por nome e ordenacao por distancia. */
export async function searchPublic(query: any) {
  const page = Math.max(0, Math.floor(Number(query.page) || 0));
  const limit = Math.min(50, Math.max(1, Math.floor(Number(query.limit) || 12)));
  const lat = parseOptionalCoordinate(query.lat);
  const lng = parseOptionalCoordinate(query.lng);
  const hasLatLng = lat !== undefined && lng !== undefined;

  const where: any = {};
  if (query.termo) {
    // Busca publica apenas pelo nome: e-mail e CPF sao dados pessoais.
    const likeOp = ProfessionalModel.sequelize?.getDialect() === "postgres" ? Op.iLike : Op.like;
    where["$User.name$"] = { [likeOp]: `%${String(query.termo)}%` };
  }

  // lat/lng ja validados como numeros finitos: seguros para interpolar.
  const distanceLiteral = hasLatLng
    ? literal(`
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(${lat})) * cos(radians("MainAddress"."lat")) *
            cos(radians("MainAddress"."lng") - radians(${lng})) +
            sin(radians(${lat})) * sin(radians("MainAddress"."lat"))
          ))
        )
      `)
    : null;

  const { rows, count } = await ProfessionalModel.findAndCountAll({
    attributes: distanceLiteral
      ? ["id", [distanceLiteral, "distance_km"]]
      : ["id"],
    subQuery: false,
    include: [
      {
        model: UserModel,
        as: "User",
        attributes: ["id", "name", "avatar_uri", "banner_uri"],
        required: true,
      },
      {
        model: AddressModel,
        as: "MainAddress",
        attributes: ["lat", "lng", "city", "state"],
        required: false,
      },
      {
        model: ServiceModel,
        as: "Services",
        required: false,
        attributes: ["title"],
        where: { active: true },
        separate: true,
      },
      {
        model: AppointmentModel,
        as: "Appointments",
        attributes: ["rating"],
        required: false,
        separate: true,
        where: COMPLETED_WITH_RATING,
      },
    ],
    where,
    order: distanceLiteral ? [[distanceLiteral, "ASC"]] : [["created_at", "DESC"]],
    limit,
    offset: page * limit,
    distinct: true,
  });

  const professionals = rows.map((prof: any) => ({
    id: prof.id,
    name: prof.User?.name || "Profissional",
    avatar_uri: prof.User?.avatar_uri,
    banner_uri: prof.User?.banner_uri,
    MainAddress: prof.MainAddress
      ? {
          city: prof.MainAddress.city,
          state: prof.MainAddress.state,
          lat: prof.MainAddress.lat,
          lng: prof.MainAddress.lng,
        }
      : null,
    Services: prof.Services || [],
    distance_km: prof.dataValues.distance_km,
    ...averageRating((prof.Appointments ?? []).map((a: any) => a.rating)),
  }));

  return {
    professionals,
    totalCount: count,
    currentPage: page,
    pageSize: limit,
    totalPages: Math.ceil(count / limit),
  };
}

/**
 * Perfil publico. Nao expoe CPF/CNPJ, e-mail nem dados pessoais de quem
 * avaliou (apenas nome e foto).
 */
export async function getPublicProfile(rawId: unknown) {
  const professional = await ProfessionalModel.findByPk(parsePositiveId(rawId), {
    attributes: PUBLIC_PROFESSIONAL_ATTRIBUTES,
    include: [
      { model: UserModel, as: "User", attributes: ["id", "name", "avatar_uri", "banner_uri"] },
      { model: AddressModel, as: "MainAddress", attributes: PUBLIC_ADDRESS_ATTRIBUTES },
      { model: ServiceModel, as: "Services", where: { active: true }, required: false },
      {
        model: AppointmentModel,
        as: "Appointments",
        attributes: ["id", "rating", "review", "createdAt", "updatedAt"],
        where: COMPLETED_WITH_RATING,
        required: false,
        include: [
          {
            model: ClientModel,
            as: "Client",
            attributes: ["id"],
            include: [{ model: UserModel, as: "User", attributes: ["name", "avatar_uri"] }],
          },
          { model: ServiceModel, as: "Service", attributes: ["title"] },
        ],
      },
    ],
  });
  if (!professional) throw HttpError.notFound("Profissional não encontrado");

  const data: any = professional;
  const { rating, ratings_count } = averageRating(
    (data.Appointments ?? []).map((a: any) => a.rating),
    2,
  );
  return { ...data.toJSON(), rating: ratings_count ? rating : null, ratings_count };
}

/**
 * Profissionais com horario livre numa data para uma subcategoria,
 * respeitando o raio de atuacao quando a localizacao do cliente e informada.
 */
export async function searchAvailability(query: any) {
  if (!query.subCategoryId || !query.date) {
    throw HttpError.badRequest("subCategoryId e date são obrigatórios.");
  }
  const subCategoryId = parsePositiveId(query.subCategoryId, "subCategoryId");
  const date = parseIsoDate(query.date);
  const lat = parseOptionalCoordinate(query.lat);
  const lng = parseOptionalCoordinate(query.lng);
  const hasLatLng = lat !== undefined && lng !== undefined;

  const professionals = await ProfessionalModel.findAll({
    attributes: ["id", "service_radius_km"],
    include: [
      {
        model: ServiceModel,
        as: "Services",
        where: { subcategory_id: subCategoryId, active: true },
        required: true,
      },
      { model: UserModel, as: "User", attributes: ["name", "avatar_uri"] },
      { model: AddressModel, as: "MainAddress", attributes: ["city", "state", "lat", "lng"] },
    ],
  });
  if (professionals.length === 0) return [];

  const ratings = await ratingsByProfessional(professionals.map((p) => p.id));

  const results = await Promise.all(
    professionals.map(async (prof: any) => {
      const address = prof.MainAddress;
      const distance =
        hasLatLng && address
          ? distanceKm(lat!, lng!, Number(address.lat), Number(address.lng))
          : 0;
      const radius = prof.service_radius_km ? Number(prof.service_radius_km) : null;
      if (radius && hasLatLng && distance > radius) return null;

      // Pode haver varios servicos na subcategoria: usa o primeiro com vaga.
      for (const service of prof.Services as any[]) {
        const slots = await getAvailableSlots(prof.id, date, service.duration || 60, service.id);
        if (slots.length === 0) continue;

        const { rating, ratings_count } = averageRating(ratings.get(prof.id) ?? []);
        return {
          id: prof.id,
          name: prof.User?.name,
          imageUrl: prof.User?.avatar_uri,
          serviceName: service.title,
          priceFrom: service.price,
          serviceId: service.id,
          rating,
          ratingsCount: ratings_count,
          distance: Number.isFinite(distance) ? parseFloat(distance.toFixed(1)) : 0,
          location: `${address?.city}, ${address?.state}`,
          offeredServices: prof.Services.map((s: any) => s.title),
          availableTimes: slots,
        };
      }
      return null;
    }),
  );

  const available = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (hasLatLng) available.sort((a, b) => a.distance - b.distance);
  return available;
}

// ---------------------------------------------------------------------------
// Gestao pelo proprio profissional
// ---------------------------------------------------------------------------

/** Transforma o usuario autenticado em profissional (RF02). */
export async function register(userId: number, input: { cpf?: unknown; cnpj?: unknown; description?: unknown }) {
  const { cpf, cnpj } = parseDocuments(input);
  const description = parseDescription(input.description, true);

  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  if (await ProfessionalModel.findOne({ where: { user_id: userId } })) {
    throw HttpError.badRequest("Usuário já é um profissional");
  }

  const client = await ClientModel.findOne({
    where: { user_id: userId },
    attributes: ["main_address_id"],
  });

  let created: ProfessionalModel;
  try {
    created = await ProfessionalModel.create({
      user_id: userId,
      main_address_id: client?.main_address_id || undefined,
      cpf: cpf as string,
      cnpj,
      description,
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const field = error.errors?.[0]?.path;
      throw HttpError.conflict(
        field === "cpf"
          ? "Este CPF já está associado a um profissional"
          : field === "cnpj"
            ? "Este CNPJ já está associado a um profissional"
            : `${field ?? "campo"} já está registrado`,
      );
    }
    throw error;
  }

  return findWithRelations(created.id);
}

/** Atualiza descricao, endereco principal (do proprio usuario) e raio. */
export async function update(
  userId: number,
  rawId: unknown,
  input: { description?: unknown; main_address_id?: unknown; service_radius_km?: unknown },
) {
  const professional = await requireOwnProfessional(userId, rawId, "atualizar");

  if (input.description !== undefined) {
    professional.description = parseDescription(input.description, false);
  }
  if (input.main_address_id !== undefined) {
    const addressId = parsePositiveId(input.main_address_id, "main_address_id");
    const address = await AddressModel.findByPk(addressId);
    if (!address || address.user_id !== userId) {
      throw HttpError.badRequest("Endereço inválido para este usuário");
    }
    professional.main_address_id = addressId;
  }
  if (input.service_radius_km !== undefined) {
    professional.service_radius_km = parseRadiusKm(input.service_radius_km);
  }

  await professional.save();
  return findWithRelations(professional.id);
}

export async function getRadius(userId: number, rawId: unknown) {
  const professional = await requireOwnProfessional(userId, rawId, "consultar");
  return { service_radius_km: professional.service_radius_km };
}

export async function updateRadius(userId: number, rawId: unknown, rawRadius: unknown) {
  const professional = await requireOwnProfessional(userId, rawId, "atualizar");
  if (rawRadius === undefined) throw HttpError.badRequest("service_radius_km é obrigatório");
  professional.service_radius_km = parseRadiusKm(rawRadius);
  await professional.save();
  return { message: "Raio atualizado", service_radius_km: professional.service_radius_km };
}

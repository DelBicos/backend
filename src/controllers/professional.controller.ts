import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { Op, literal } from "sequelize";
import { ProfessionalModel } from "../models/Professional";
import { UserModel } from "../models/User";
import { AddressModel } from "../models/Address";
import { ServiceModel } from "../models/Service";
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import { ProfessionalAvailabilityModel } from "../models/ProfessionalAvailability";
import { ServiceAvailabilityModel } from "../models/ServiceAvailability";
import { getAvailableSlots } from "../services/availability.service";

export const getProfessionals = async (req: Request, res: Response) => {
  try {
    const { termo, page = 0, limit = 12, lat, lng } = req.query;
    const latNum = lat ? parseFloat(String(lat)) : undefined;
    const lngNum = lng ? parseFloat(String(lng)) : undefined;
    const hasLatLng = Number.isFinite(latNum) && Number.isFinite(lngNum);

    const where: any = {};
    if (termo) {
      where[Op.or] = [
        { "$User.name$": { [Op.like]: `%${termo}%` } },
        { "$User.email$": { [Op.like]: `%${termo}%` } },
        { cpf: { [Op.like]: `%${termo}%` } },
      ];
    }

    const distanceLiteral = hasLatLng
      ? literal(`
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(${latNum})) * cos(radians("MainAddress"."lat")) *
            cos(radians("MainAddress"."lng") - radians(${lngNum})) +
            sin(radians(${latNum})) * sin(radians("MainAddress"."lat"))
          ))
        )
      `)
      : null;

    console.log(distanceLiteral);

    const order: any[] = [];
    if (hasLatLng && distanceLiteral) {
      order.push([distanceLiteral, "ASC"]);
    } else {
      order.push(["created_at", "DESC"]);
    }

    const attributes: any = { include: [] };

    if (hasLatLng && distanceLiteral) {
      attributes.include.push([distanceLiteral, "distance_km"]);
    }

    const { rows, count } = await ProfessionalModel.findAndCountAll({
      attributes,
      subQuery: false,
      include: [
        {
          model: UserModel,
          as: "User",
          attributes: ["id", "name", "email", "avatar_uri", "banner_uri"],
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
          separate: true,
        },
        {
          model: AppointmentModel,
          as: "Appointments",
          attributes: ["rating"],
          required: false,
          separate: true,
          where: {
            status: "completed",
            rating: { [Op.ne]: null },
          },
        },
      ],
      where,
      order,
      limit: Number(limit),
      offset: Number(page) * Number(limit),
      distinct: true,
    });

    const professionals = rows.map((prof: any) => {
      const apps = (prof.Appointments ?? []) as Array<{ rating: number }>;
      const ratingsCount = apps.length;
      const ratingSum = apps.reduce((sum, a) => sum + a.rating, 0);
      const ratingAvg = ratingsCount > 0 ? ratingSum / ratingsCount : 0;

      return {
        id: prof.id,
        name: prof.User?.name || "Profissional",
        email: prof.User?.email,
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

        rating: parseFloat(ratingAvg.toFixed(1)),
        ratings_count: ratingsCount,
      };
    });

    return res.json({
      professionals,
      totalCount: count,
      currentPage: Number(page),
      pageSize: Number(limit),
      totalPages: Math.ceil(count / Number(limit)),
    });
  } catch (error) {
    console.error("Erro ao buscar profissionais:", error);
    return res.status(500).json({
      error: "Erro ao buscar profissionais",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getProfessionalRadius = async (req: any, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId)
      return res.status(401).json({ error: "Usuário não autenticado" });

    const professionalId = Number(req.params.id);
    if (!professionalId)
      return res.status(400).json({ error: "ID do profissional inválido" });

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });

    if (professional.user_id !== userId) {
      return res.status(403).json({ error: "Não autorizado" });
    }

    return res.json({ service_radius_km: professional.service_radius_km });
  } catch (error: any) {
    console.error("Erro ao obter raio do profissional:", error);
    return res
      .status(500)
      .json({ error: "Erro interno", details: error.message });
  }
};

export const updateProfessionalRadius = async (req: any, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId)
      return res.status(401).json({ error: "Usuário não autenticado" });

    const professionalId = Number(req.params.id);
    if (!professionalId)
      return res.status(400).json({ error: "ID do profissional inválido" });

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });

    if (professional.user_id !== userId) {
      return res.status(403).json({ error: "Não autorizado" });
    }

    const { service_radius_km } = req.body;
    if (service_radius_km === undefined) {
      return res.status(400).json({ error: "service_radius_km é obrigatório" });
    }
    const km = Number(service_radius_km);
    if (!Number.isFinite(km) || km < 0) {
      return res
        .status(400)
        .json({ error: "service_radius_km deve ser um número >= 0" });
    }
    professional.service_radius_km = Math.floor(km);
    await professional.save();

    return res.json({
      message: "Raio atualizado",
      service_radius_km: professional.service_radius_km,
    });
  } catch (error: any) {
    console.error("Erro ao atualizar raio:", error);
    return res
      .status(500)
      .json({ error: "Erro interno", details: error.message });
  }
};

export const getProfessionalById = async (req: Request, res: Response) => {
  try {
    const professional = await ProfessionalModel.findByPk(req.params.id, {
      include: [
        {
          model: UserModel,
          as: "User",
          attributes: ["id", "name", "email", "avatar_uri", "banner_uri"],
        },
        { model: AddressModel, as: "MainAddress" },
        { model: ServiceModel, as: "Services" },
        // { model: AmenitiesModel, as: "Amenities", through: { attributes: [] } },
        // { model: ProfessionalGalleryModel, as: "Gallery" },
        // {
        //   model: ProfessionalAvailabilityModel,
        //   as: "Availabilities",
        //   where: { is_available: true },
        // },
        {
          model: AppointmentModel,
          as: "Appointments",
          where: { status: "completed", rating: { [Op.not]: null } },
          required: false,
          include: [
            {
              model: ClientModel,
              as: "Client",
              include: [
                {
                  model: UserModel,
                  as: "User",
                  attributes: ["name", "avatar_uri"],
                },
              ],
            },
            {
              model: ServiceModel,
              as: "Service",
              attributes: ["title"],
            },
          ],
        },
      ],
    });

    if (!professional) {
      return res.status(404).json({ error: "Profissional não encontrado" });
    }

    const profData: any = professional;
    const appointments = (profData.Appointments ?? []) as Array<{
      rating: number | null;
    }>;

    const ratings = appointments
      .map((a) => a?.rating ?? null)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    const ratings_count = ratings.length;
    const rating =
      ratings_count > 0
        ? Math.round(
            (ratings.reduce((s, n) => s + n, 0) / ratings_count) * 100,
          ) / 100
        : null;

    profData.setDataValue("rating", rating);
    profData.setDataValue("ratings_count", ratings_count);

    return res.json(professional);
  } catch (error) {
    console.error("Erro ao buscar profissional:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// getAvailableSlots foi extraído para src/services/availability.service.ts
// e importado no topo deste arquivo para reuso pelo bot e por este controller.

export const searchProfessionalAvailability = async (
  req: Request,
  res: Response,
) => {
  const { subCategoryId, date, lat, lng } = req.query;

  if (!subCategoryId || !date) {
    return res
      .status(400)
      .json({ error: "subCategoryId e date são obrigatórios." });
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Formato de data inválido. Use AAAA-MM-DD." });
  }

  const latNum = typeof lat === "string" ? parseFloat(lat) : undefined;
  const lngNum = typeof lng === "string" ? parseFloat(lng) : undefined;
  const hasLatLng = Number.isFinite(latNum) && Number.isFinite(lngNum);

  try {
    const professionals = await ProfessionalModel.findAll({
      include: [
        {
          model: ServiceModel,
          as: "Services",
          where: { subcategory_id: Number(subCategoryId), active: true },
          required: true,
        },
        { model: UserModel, as: "User", attributes: ["name", "avatar_uri"] },
        {
          model: AddressModel,
          as: "MainAddress",
          attributes: ["city", "state", "lat", "lng"],
        },
      ],
    });
    if (!professionals.length) {
      return res.json([]);
    }

    const getDistance = (profLat: number, profLng: number) => {
      if (!hasLatLng) return 0;
      const toRad = (x: number) => (x * Math.PI) / 180;
      const R = 6371;

      const dLat = toRad(profLat - latNum!);
      const dLon = toRad(profLng - lngNum!);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(latNum!)) *
          Math.cos(toRad(profLat)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const resultsPromises = professionals.map(async (prof: any) => {
      // Pode haver múltiplos serviços do profissional na mesma subcategoria.
      // Tenta cada um em ordem até encontrar o que tem slots no dia solicitado.
      const relevantServices: any[] = prof.Services.filter(
        (s: any) => s.subcategory_id === Number(subCategoryId),
      );

      let relevantService: any = null;
      let availableTimes: string[] = [];

      for (const svc of relevantServices) {
        const slots = await getAvailableSlots(
          prof.id,
          date as string,
          svc.duration || 60,
          svc.id,
        );
        if (slots.length > 0) {
          relevantService = svc;
          availableTimes = slots;
          break;
        }
      }

      if (availableTimes.length === 0) {
        return null;
      }

      type ProfWithAppointments = ProfessionalModel & {
        Appointments?: { rating: number | null }[];
      };

      const professionalWithAppointments = (await ProfessionalModel.findByPk(
        prof.id,
        {
          include: [
            {
              model: AppointmentModel,
              as: "Appointments",
              where: { status: "completed", rating: { [Op.not]: null } },
              attributes: ["rating"],
              required: false,
            },
          ],
        },
      )) as ProfWithAppointments | null;

      const ratings =
        professionalWithAppointments?.Appointments?.map((a) => a.rating) || [];
      const ratingsCount = ratings.length;
      const averageRating =
        ratingsCount > 0
          ? ratings.reduce(
              (acc: number, val: number | null | undefined) => acc + (val || 0),
              0,
            ) / ratingsCount
          : 0;
      const distance = prof.MainAddress
        ? getDistance(
            parseFloat(prof.MainAddress.lat),
            parseFloat(prof.MainAddress.lng),
          )
        : 0;

      // Se o profissional definiu um raio de atuação, filtra por ele quando lat/lng do usuário forem fornecidos
      const profRadius = prof.service_radius_km
        ? Number(prof.service_radius_km)
        : null;
      if (profRadius && hasLatLng && distance > profRadius) {
        return null;
      }
      return {
        id: prof.id,
        name: prof.User.name,
        imageUrl: prof.User.avatar_uri,
        serviceName: relevantService.title,
        priceFrom: relevantService.price,
        serviceId: relevantService.id,
        rating: parseFloat(averageRating.toFixed(1)),
        ratingsCount: ratingsCount,
        distance: parseFloat(distance.toFixed(1)),
        location: `${prof.MainAddress?.city}, ${prof.MainAddress?.state}`,
        offeredServices: prof.Services.map((s: any) => s.title),
        availableTimes: availableTimes,
      };
    });

    let results = (await Promise.all(resultsPromises)).filter(
      (result) => result !== null,
    ) as any[];

    if (hasLatLng) {
      results.sort((a, b) => a.distance - b.distance);
    }

    return res.json(results);
  } catch (error: any) {
    console.error("Erro ao buscar disponibilidade:", error);
    return res
      .status(500)
      .json({ error: "Erro interno do servidor", details: error.message });
  }
};

export const createProfessional = async (
  req: any,
  res: Response,
): Promise<any> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Usuário não autenticado",
      });
    }

    let { cpf, cnpj, description } = req.body;

    // Remover formatação (pontos, traços, barras) e manter apenas números
    if (cpf && typeof cpf === "string") {
      cpf = cpf.replace(/\D/g, "");
    }
    if (cnpj && typeof cnpj === "string") {
      cnpj = cnpj.replace(/\D/g, "");
    }

    // Validação: deve ter CPF ou CNPJ (pelo menos um)
    if (!cpf && !cnpj) {
      return res.status(400).json({
        error: "CPF ou CNPJ é obrigatório",
      });
    }

    if (!description) {
      return res.status(400).json({
        error: "Descrição é obrigatória",
      });
    }

    // Verificar se o usuário existe
    const user = await UserModel.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: "Usuário não encontrado",
      });
    }

    // Verificar se o usuário já é um profissional
    const existingProfessional = await ProfessionalModel.findOne({
      where: { user_id: userId },
    });
    if (existingProfessional) {
      return res.status(400).json({
        error: "Usuário já é um profissional",
      });
    }

    // Buscar o endereço principal do usuário (via Client)
    const client = await ClientModel.findOne({
      where: { user_id: userId },
      attributes: ["main_address_id"],
    });

    const mainAddressId = client?.main_address_id || undefined;

    // Criar novo profissional
    const newProfessional = await ProfessionalModel.create({
      user_id: userId,
      main_address_id: mainAddressId,
      cpf: cpf || undefined,
      cnpj: cnpj || undefined,
      description,
    });

    // Buscar o profissional criado com as associações
    const professionalWithRelations = await ProfessionalModel.findByPk(
      newProfessional.id,
      {
        include: [
          {
            model: UserModel,
            as: "User",
            attributes: ["id", "name", "email", "avatar_uri", "banner_uri"],
          },
          {
            model: AddressModel,
            as: "MainAddress",
            attributes: ["id", "city", "state", "lat", "lng"],
          },
        ],
      },
    );

    return res.status(201).json({
      message: "Profissional registrado com sucesso",
      professional: professionalWithRelations,
    });
  } catch (error: any) {
    console.error("Erro ao criar profissional:", error);

    // Tratamento de erros de constraint UNIQUE
    if (error.name === "SequelizeUniqueConstraintError") {
      const field = error.errors?.[0]?.path || "campo";
      let errorMessage = `${field} já está registrado`;

      if (field === "cpf") {
        errorMessage = "Este CPF já está associado a um profissional";
      } else if (field === "cnpj") {
        errorMessage = "Este CNPJ já está associado a um profissional";
      }

      return res.status(409).json({
        error: errorMessage,
      });
    }

    return res.status(500).json({
      error: "Erro ao criar profissional",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

export const updateProfessional = async (req: any, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId)
      return res.status(401).json({ error: "Usuário não autenticado" });

    const professionalId = Number(req.params.id);
    if (!professionalId)
      return res.status(400).json({ error: "ID do profissional inválido" });

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });

    // Só o dono (usuário ligado ao profissional) pode atualizar
    if (professional.user_id !== userId) {
      return res
        .status(403)
        .json({ error: "Não autorizado a atualizar este profissional" });
    }

    const { description, main_address_id, service_radius_km } = req.body;

    if (description !== undefined) professional.description = description;
    if (main_address_id !== undefined)
      professional.main_address_id = main_address_id;
    if (service_radius_km !== undefined) {
      const km = Number(service_radius_km);
      if (!Number.isFinite(km) || km < 0) {
        return res
          .status(400)
          .json({ error: "service_radius_km deve ser um número >= 0" });
      }
      professional.service_radius_km = Math.floor(km);
    }

    await professional.save();

    const professionalWithRelations = await ProfessionalModel.findByPk(
      professional.id,
      {
        include: [
          {
            model: UserModel,
            as: "User",
            attributes: ["id", "name", "email", "avatar_uri"],
          },
          {
            model: AddressModel,
            as: "MainAddress",
            attributes: ["id", "city", "state", "lat", "lng"],
          },
        ],
      },
    );

    return res.json({
      message: "Profissional atualizado",
      professional: professionalWithRelations,
    });
  } catch (error: any) {
    console.error("Erro ao atualizar profissional:", error);
    return res.status(500).json({
      error: "Erro ao atualizar profissional",
      details: error.message,
    });
  }
};

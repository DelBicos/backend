import { withProfessionalScheduleLock } from "../services/appointmentSchedule.service";
import { Request, Response } from "express";
import { Op } from "sequelize";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { ProfessionalAvailabilityModel } from "../models/ProfessionalAvailability";
import { ProfessionalModel } from "../models/Professional";

/** Verifica se existe sobreposição de availability para o mesmo profissional.
 *  Dois períodos [A, B] e [C, D] se sobrepõem quando A < D && C < B. */
async function hasAvailabilityOverlap(
  professionalId: number,
  startTime: string,
  endTime: string,
  recurrencePattern: string,
  daysOfWeek?: string,
  startDay?: string | null,
  endDay?: string | null,
  excludeId?: number,
): Promise<boolean> {
  const where: any = {
    professional_id: professionalId,
    recurrence_pattern: recurrencePattern,
    start_time: { [Op.lt]: endTime },
    end_time: { [Op.gt]: startTime },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  if (recurrencePattern === "none" && startDay && endDay) {
    where.start_day = { [Op.lt]: endDay };
    where.end_day = { [Op.gt]: startDay };
  }

  const existing = await ProfessionalAvailabilityModel.findOne({ where });
  if (!existing) return false;

  // Para weekly, verificar se há dias em comum
  if (recurrencePattern === "weekly" && daysOfWeek && existing.days_of_week) {
    for (let i = 0; i < 7; i++) {
      if (daysOfWeek[i] === "1" && existing.days_of_week[i] === "1")
        return true;
    }
    return false;
  }

  return true;
}

export const listAvailability = async (req: Request, res: Response) => {
  try {
    const professionalId = Number(req.params.professionalId);
    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ error: "professionalId inválido" });
    }

    const availabilities = await ProfessionalAvailabilityModel.findAll({
      where: { professional_id: professionalId },
      order: [
        ["start_day", "ASC"],
        ["start_time", "ASC"],
      ],
    });

    return res.json(availabilities);
  } catch (error: any) {
    console.error("Erro listAvailability:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getAvailability = async (req: Request, res: Response) => {
  try {
    const professionalId = Number(req.params.professionalId);
    const id = Number(req.params.id);
    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ error: "professionalId inválido" });
    }
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const availability = await ProfessionalAvailabilityModel.findOne({
      where: { id, professional_id: professionalId },
    });
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    return res.json(availability);
  } catch (error: any) {
    console.error("Erro getAvailability:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const createAvailability = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const professionalId = Number(req.params.professionalId);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ error: "professionalId inválido" });
    }

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });
    if (professional.user_id !== req.user.id)
      return res.status(403).json({
        error: "Sem permissão para alterar disponibilidades deste profissional",
      });

    const payload = {
      professional_id: professionalId,
      days_of_week: req.body.days_of_week,
      start_day_of_month: req.body.start_day_of_month || null,
      end_day_of_month: req.body.end_day_of_month || null,
      start_day: req.body.start_day || null,
      end_day: req.body.end_day || null,
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      is_available:
        typeof req.body.is_available === "boolean"
          ? req.body.is_available
          : true,
      recurrence_pattern: req.body.recurrence_pattern || "none",
    };

    const overlap = await hasAvailabilityOverlap(
      professionalId,
      payload.start_time,
      payload.end_time,
      payload.recurrence_pattern,
      payload.days_of_week,
      payload.start_day,
      payload.end_day,
    );
    if (overlap)
      return res.status(409).json({
        error:
          "Conflito de disponibilidade: já existe uma disponibilidade que se sobrepõe a este horário",
      });

    const created = await withProfessionalScheduleLock(professionalId, transaction => ProfessionalAvailabilityModel.create(payload as any, { transaction }));
    return res.status(201).json(created);
  } catch (error: any) {
    console.error("Erro createAvailability:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateAvailability = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const professionalId = Number(req.params.professionalId);
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ error: "professionalId inválido" });
    }
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });
    if (professional.user_id !== req.user.id)
      return res.status(403).json({
        error: "Sem permissão para alterar disponibilidades deste profissional",
      });

    const availability = await ProfessionalAvailabilityModel.findOne({
      where: { id, professional_id: professionalId },
    });
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    const updatable = [
      "days_of_week",
      "start_day_of_month",
      "end_day_of_month",
      "start_day",
      "end_day",
      "start_time",
      "end_time",
      "is_available",
      "recurrence_pattern",
    ];
    for (const key of updatable) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        // @ts-ignore
        availability[key] = req.body[key];
      }
    }

    await withProfessionalScheduleLock(availability.professional_id, transaction => availability.save({ transaction }));
    return res.json(availability);
  } catch (error: any) {
    console.error("Erro updateAvailability:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteAvailability = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const professionalId = Number(req.params.professionalId);
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ error: "professionalId inválido" });
    }
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const professional = await ProfessionalModel.findByPk(professionalId);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });
    if (professional.user_id !== req.user.id)
      return res.status(403).json({
        error: "Sem permissão para alterar disponibilidades deste profissional",
      });

    const availability = await ProfessionalAvailabilityModel.findOne({
      where: { id, professional_id: professionalId },
    });
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    // Soft-disable availability
    availability.is_available = false;
    await withProfessionalScheduleLock(availability.professional_id, transaction => availability.save({ transaction }));
    return res.status(200).json({ message: "Disponibilidade desativada" });
  } catch (error: any) {
    console.error("Erro deleteAvailability:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ─── Standalone handlers (sem professionalId no path) ────────────────────────

// GET /api/availabilities/:id
export const getAvailabilityById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const availability = await ProfessionalAvailabilityModel.findByPk(id);
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    return res.json(availability);
  } catch (error: any) {
    console.error("Erro getAvailabilityById:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// PUT /api/availabilities/:id
export const updateAvailabilityById = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const availability = await ProfessionalAvailabilityModel.findByPk(id);
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    const professional = await ProfessionalModel.findByPk(
      availability.professional_id,
    );
    if (!professional || professional.user_id !== req.user.id)
      return res
        .status(403)
        .json({ error: "Sem permissão para alterar esta disponibilidade" });

    const updatable = [
      "days_of_week",
      "start_day_of_month",
      "end_day_of_month",
      "start_day",
      "end_day",
      "start_time",
      "end_time",
      "is_available",
      "recurrence_pattern",
    ];
    for (const key of updatable) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        // @ts-ignore
        availability[key] = req.body[key];
      }
    }

    await withProfessionalScheduleLock(availability.professional_id, transaction => availability.save({ transaction }));
    return res.json(availability);
  } catch (error: any) {
    console.error("Erro updateAvailabilityById:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// DELETE /api/availabilities/:id
export const deleteAvailabilityById = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const availability = await ProfessionalAvailabilityModel.findByPk(id);
    if (!availability)
      return res.status(404).json({ error: "Disponibilidade não encontrada" });

    const professional = await ProfessionalModel.findByPk(
      availability.professional_id,
    );
    if (!professional || professional.user_id !== req.user.id)
      return res
        .status(403)
        .json({ error: "Sem permissão para alterar esta disponibilidade" });

    availability.is_available = false;
    await withProfessionalScheduleLock(availability.professional_id, transaction => availability.save({ transaction }));
    return res.status(204).send();
  } catch (error: any) {
    console.error("Erro deleteAvailabilityById:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

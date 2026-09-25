/**
 * Janelas de disponibilidade do profissional (agenda recorrente ou pontual).
 *
 * As rotas aninhadas (/professionals/:professionalId/availabilities/:id) e as
 * avulsas (/availabilities/:id) usam os mesmos casos de uso; nas aninhadas o
 * professionalId restringe o escopo da busca.
 */
import { Op } from "sequelize";
import { ProfessionalAvailabilityModel } from "../../models/ProfessionalAvailability";
import { ProfessionalModel } from "../../models/Professional";
import { HttpError } from "../../errors/HttpError";
import { parsePositiveId } from "../catalog/catalog.rules";

const UPDATABLE_FIELDS = [
  "days_of_week",
  "start_day_of_month",
  "end_day_of_month",
  "start_day",
  "end_day",
  "start_time",
  "end_time",
  "is_available",
  "recurrence_pattern",
] as const;

export interface AvailabilityWindow {
  start_time: string;
  end_time: string;
  recurrence_pattern: string;
  days_of_week?: string | null;
  start_day?: string | null;
  end_day?: string | null;
}

/** Mascaras "1010100" (dom..sab) compartilham algum dia? */
export function weekdaysIntersect(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // sem mascara: trata como qualquer dia
  for (let i = 0; i < 7; i++) {
    if (a[i] === "1" && b[i] === "1") return true;
  }
  return false;
}

/**
 * Existe outra janela do mesmo profissional que se sobrepoe a esta?
 * Dois periodos [A, B] e [C, D] se sobrepoem quando A < D && C < B.
 */
export async function hasOverlap(
  professionalId: number,
  window: AvailabilityWindow,
  excludeId?: number,
): Promise<boolean> {
  const where: any = {
    professional_id: professionalId,
    recurrence_pattern: window.recurrence_pattern,
    is_available: true,
    start_time: { [Op.lt]: window.end_time },
    end_time: { [Op.gt]: window.start_time },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  if (window.recurrence_pattern === "none" && window.start_day && window.end_day) {
    where.start_day = { [Op.lt]: window.end_day };
    where.end_day = { [Op.gt]: window.start_day };
  }

  const candidates = await ProfessionalAvailabilityModel.findAll({ where });
  if (window.recurrence_pattern !== "weekly") return candidates.length > 0;
  return candidates.some((c) => weekdaysIntersect(window.days_of_week, c.days_of_week));
}

async function assertOwner(professionalId: number, userId: number) {
  const professional = await ProfessionalModel.findByPk(professionalId);
  if (!professional) throw HttpError.notFound("Profissional não encontrado");
  if (professional.user_id !== userId) {
    throw HttpError.forbidden("Sem permissão para alterar disponibilidades deste profissional");
  }
}

async function findScoped(rawId: unknown, rawProfessionalId?: unknown) {
  const id = parsePositiveId(rawId);
  const where: any = { id };
  if (rawProfessionalId !== undefined) {
    where.professional_id = parsePositiveId(rawProfessionalId, "professionalId");
  }
  const availability = await ProfessionalAvailabilityModel.findOne({ where });
  if (!availability) throw HttpError.notFound("Disponibilidade não encontrada");
  return availability;
}

const CONFLICT_MESSAGE =
  "Conflito de disponibilidade: já existe uma disponibilidade que se sobrepõe a este horário";

export async function list(rawProfessionalId: unknown) {
  return ProfessionalAvailabilityModel.findAll({
    where: { professional_id: parsePositiveId(rawProfessionalId, "professionalId") },
    order: [
      ["start_day", "ASC"],
      ["start_time", "ASC"],
    ],
  });
}

export async function get(rawId: unknown, rawProfessionalId?: unknown) {
  return findScoped(rawId, rawProfessionalId);
}

export async function create(userId: number, rawProfessionalId: unknown, body: any) {
  const professionalId = parsePositiveId(rawProfessionalId, "professionalId");
  await assertOwner(professionalId, userId);

  const payload = {
    professional_id: professionalId,
    days_of_week: body.days_of_week,
    start_day_of_month: body.start_day_of_month || null,
    end_day_of_month: body.end_day_of_month || null,
    start_day: body.start_day || null,
    end_day: body.end_day || null,
    start_time: body.start_time,
    end_time: body.end_time,
    is_available: typeof body.is_available === "boolean" ? body.is_available : true,
    recurrence_pattern: body.recurrence_pattern || "none",
  };

  if (await hasOverlap(professionalId, payload)) throw HttpError.conflict(CONFLICT_MESSAGE);
  return ProfessionalAvailabilityModel.create(payload as any);
}

/** Atualiza campos permitidos; a janela resultante tambem nao pode sobrepor outra. */
export async function update(
  userId: number,
  rawId: unknown,
  body: any,
  rawProfessionalId?: unknown,
) {
  const availability = await findScoped(rawId, rawProfessionalId);
  await assertOwner(availability.professional_id, userId);

  const changes: Record<string, unknown> = {};
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) changes[key] = body[key];
  }

  const merged = { ...(availability.toJSON() as any), ...changes };
  if (
    merged.is_available !== false &&
    (await hasOverlap(availability.professional_id, merged, availability.id))
  ) {
    throw HttpError.conflict(CONFLICT_MESSAGE);
  }

  await availability.update(changes);
  return availability;
}

/** Desativacao logica (is_available = false). */
export async function disable(userId: number, rawId: unknown, rawProfessionalId?: unknown) {
  const availability = await findScoped(rawId, rawProfessionalId);
  await assertOwner(availability.professional_id, userId);
  availability.is_available = false;
  await availability.save();
}

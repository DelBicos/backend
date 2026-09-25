/**
 * Bloqueios pontuais da agenda do profissional (ferias, compromissos).
 */
import { ProfessionalAvailabilityLockModel } from "../../models/ProfessionalAvailabilityLock";
import { ProfessionalModel } from "../../models/Professional";
import { HttpError } from "../../errors/HttpError";
import { parsePositiveId } from "../catalog/catalog.rules";

async function assertOwner(professionalId: number, userId: number) {
  const professional = await ProfessionalModel.findByPk(professionalId);
  if (!professional) throw HttpError.notFound("Profissional não encontrado");
  if (professional.user_id !== userId) {
    throw HttpError.forbidden("Sem permissão para alterar bloqueios deste profissional");
  }
}

export async function list(rawProfessionalId: unknown) {
  return ProfessionalAvailabilityLockModel.findAll({
    where: { professional_id: parsePositiveId(rawProfessionalId, "professionalId") },
    order: [["start_time", "ASC"]],
  });
}

export async function create(
  userId: number,
  rawProfessionalId: unknown,
  body: { start_time?: unknown; end_time?: unknown; reason?: unknown },
) {
  const professionalId = parsePositiveId(rawProfessionalId, "professionalId");
  await assertOwner(professionalId, userId);

  const start = new Date(String(body.start_time));
  const end = new Date(String(body.end_time));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw HttpError.badRequest("start_time e end_time devem ser datas válidas, com fim após o início");
  }

  return ProfessionalAvailabilityLockModel.create({
    professional_id: professionalId,
    start_time: start,
    end_time: end,
    reason: body.reason ? String(body.reason) : null,
    created_by: userId,
  } as any);
}

export async function remove(userId: number, rawId: unknown) {
  const lock = await ProfessionalAvailabilityLockModel.findByPk(parsePositiveId(rawId));
  if (!lock) throw HttpError.notFound("Bloqueio não encontrado");
  await assertOwner(lock.professional_id, userId);
  await lock.destroy();
}

import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { ProfessionalAvailabilityLockModel } from "../models/ProfessionalAvailabilityLock";
import { ProfessionalModel } from "../models/Professional";
import { withProfessionalScheduleLock } from "../services/appointmentSchedule.service";

async function assertLockOwnership(
  lock: InstanceType<typeof ProfessionalAvailabilityLockModel>,
  userId: number,
  res: Response,
): Promise<boolean> {
  const professional = await ProfessionalModel.findByPk(lock.professional_id);
  if (!professional) {
    res.status(404).json({ error: "Profissional não encontrado" });
    return false;
  }
  if (professional.user_id !== userId) {
    res
      .status(403)
      .json({
        error: "Sem permissão para alterar bloqueios deste profissional",
      });
    return false;
  }
  return true;
}

// GET /api/professionals/:professionalId/availability-locks
export const listLocks = async (req: Request, res: Response) => {
  try {
    const professionalId = Number(req.params.professionalId);
    if (!Number.isInteger(professionalId) || professionalId <= 0)
      return res.status(400).json({ error: "professionalId inválido" });

    const locks = await ProfessionalAvailabilityLockModel.findAll({
      where: { professional_id: professionalId },
      order: [["start_time", "ASC"]],
    });
    return res.json(locks);
  } catch (error: any) {
    console.error("Erro listLocks:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// POST /api/professionals/:professionalId/availability-locks
export const createLock = async (req: AuthenticatedRequest, res: Response) => {
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
      return res
        .status(403)
        .json({
          error: "Sem permissão para alterar bloqueios deste profissional",
        });

    const created = await withProfessionalScheduleLock(professionalId, transaction => ProfessionalAvailabilityLockModel.create({
      professional_id: professionalId,
      start_time: new Date(req.body.start_time),
      end_time: new Date(req.body.end_time),
      reason: req.body.reason ?? null,
      created_by: req.user!.id,
    } as any, { transaction }));
    return res.status(201).json(created);
  } catch (error: any) {
    console.error("Erro createLock:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// DELETE /api/availability-locks/:id
export const deleteLockById = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);
    if (!req.user)
      return res.status(401).json({ error: "Usuário não autenticado" });
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "id inválido" });

    const lock = await ProfessionalAvailabilityLockModel.findByPk(id);
    if (!lock)
      return res.status(404).json({ error: "Bloqueio não encontrado" });

    const owned = await assertLockOwnership(lock, req.user.id, res);
    if (!owned) return;

    await withProfessionalScheduleLock(lock.professional_id, transaction => lock.destroy({ transaction }));
    return res.status(204).send();
  } catch (error: any) {
    console.error("Erro deleteLockById:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

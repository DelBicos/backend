import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { updateAppointmentStatus as updateLegacyStatus } from "./appointment.controller";
import {
  requestCancellationCode, confirmCancellationCode, abandonCancellationCode,
  resolveCancellationAppointment, CancellationVerificationError,
} from "../services/appointment/cancellationVerification.service";
import logger from "../utils/logger";

function failure(res: Response, error: unknown) {
  if (error instanceof CancellationVerificationError) return res.status(error.status).json({ error: error.message });
  logger.warn("Falha no fluxo de verificação de cancelamento");
  return res.status(503).json({ error: "Não foi possível concluir a verificação. Tente novamente mais tarde." });
}

export const requestCancellation = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return res.status(401).json({ error: "Usuário não autenticado" });
  try {
    const id = await resolveCancellationAppointment(req.params.id);
    return res.json(await requestCancellationCode(user.id, id));
  } catch (error: unknown) { return failure(res, error); }
};

export const confirmCancellation = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return res.status(401).json({ error: "Usuário não autenticado" });
  const { challengeId, code } = (req.body ?? {}) as { challengeId?: unknown; code?: unknown };
  if (typeof challengeId !== "string" || typeof code !== "string")
    return res.status(400).json({ error: "Solicite e informe o código de confirmação enviado ao e-mail" });
  try {
    const id = await resolveCancellationAppointment(req.params.id);
    await confirmCancellationCode(user.id, id, challengeId, code.trim());
    return res.json({ status: "canceled" });
  } catch (error: unknown) { return failure(res, error); }
};

export const abandonCancellation = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return res.status(401).json({ error: "Usuário não autenticado" });
  const { challengeId } = (req.body ?? {}) as { challengeId?: unknown };
  if (typeof challengeId !== "string") return res.status(400).json({ error: "Verificação inválida" });
  try {
    const id = await resolveCancellationAppointment(req.params.id);
    await abandonCancellationCode(user.id, id, challengeId);
    return res.sendStatus(204);
  } catch (error: unknown) { return failure(res, error); }
};

// A rota legada de recusa também exige código; aceitar continua com o fluxo existente.
export const updateVerifiedAppointmentStatus = async (req: Request, res: Response) => {
  if (!req.body) return res.status(400).json({ error: "Informe o status do agendamento" });
  if (req.body.status === "canceled") return confirmCancellation(req, res);
  return updateLegacyStatus(req, res);
};

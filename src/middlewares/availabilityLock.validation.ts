import { Request, Response, NextFunction } from "express";

import { bodyOf } from "../utils/requestBody.util";
function isISODateTime(val: unknown): val is string {
  if (typeof val !== "string" || !val) return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
}

export function validateCreateLock(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { start_time, end_time } = bodyOf(req);
  if (!isISODateTime(start_time))
    return res.status(400).json({ error: "start_time inválido" });
  if (!isISODateTime(end_time))
    return res.status(400).json({ error: "end_time inválido" });
  if (new Date(start_time) >= new Date(end_time))
    return res
      .status(400)
      .json({ error: "start_time deve ser menor que end_time" });
  return next();
}

export function validateUpdateLock(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { new_start_time, new_end_time } = bodyOf(req);
  if (!new_start_time && !new_end_time)
    return res
      .status(400)
      .json({ error: "Forneça new_start_time ou new_end_time" });
  if (new_start_time && !isISODateTime(new_start_time))
    return res.status(400).json({ error: "new_start_time inválido" });
  if (new_end_time && !isISODateTime(new_end_time))
    return res.status(400).json({ error: "new_end_time inválido" });
  if (
    isISODateTime(new_start_time) &&
    isISODateTime(new_end_time) &&
    new Date(new_start_time) >= new Date(new_end_time)
  )
    return res
      .status(400)
      .json({ error: "new_start_time deve ser menor que new_end_time" });
  return next();
}

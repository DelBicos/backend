import { Request, Response, NextFunction } from "express";

import { bodyOf } from "../utils/requestBody.util";
const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
const daysOfWeekRegex = /^[01]{7}$/;

const isTime = (v: unknown): v is string => typeof v === "string" && timeRegex.test(v);
const isDays = (v: unknown): v is string =>
  typeof v === "string" && daysOfWeekRegex.test(v);

export function validateCreateAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const {
    start_time,
    end_time,
    recurrence_pattern,
    days_of_week,
    start_day,
    end_day,
    start_day_of_month,
  } = bodyOf(req);

  if (!start_time || !isTime(start_time))
    return res
      .status(400)
      .json({ error: "start_time inválido (HH:MM ou HH:MM:SS)" });
  if (!end_time || !isTime(end_time))
    return res
      .status(400)
      .json({ error: "end_time inválido (HH:MM ou HH:MM:SS)" });

  // start_time < end_time (comparação simples)
  if (String(start_time) >= String(end_time))
    return res
      .status(400)
      .json({ error: "start_time deve ser menor que end_time" });

  if (recurrence_pattern === "weekly") {
    if (!days_of_week || !isDays(days_of_week))
      return res
        .status(400)
        .json({ error: "days_of_week inválido (7 chars 0/1)" });
  }

  if (recurrence_pattern === "monthly") {
    if (!start_day_of_month || typeof start_day_of_month !== "number")
      return res
        .status(400)
        .json({ error: "start_day_of_month obrigatório para monthly" });
  }

  if (recurrence_pattern === "none") {
    if (!start_day || !end_day)
      return res.status(400).json({
        error: "start_day e end_day obrigatórios para recurrence 'none'",
      });
  }

  return next();
}

export function validateUpdateAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Reaproveitar validação básica do create para alterações parciais apenas quando campos enviados
  const body = bodyOf(req);
  if (body.start_time && !isTime(body.start_time))
    return res
      .status(400)
      .json({ error: "start_time inválido (HH:MM ou HH:MM:SS)" });
  if (body.end_time && !isTime(body.end_time))
    return res
      .status(400)
      .json({ error: "end_time inválido (HH:MM ou HH:MM:SS)" });
  if (body.days_of_week && !isDays(body.days_of_week))
    return res
      .status(400)
      .json({ error: "days_of_week inválido (7 chars 0/1)" });
  if (isTime(body.start_time) && isTime(body.end_time) && body.start_time >= body.end_time)
    return res
      .status(400)
      .json({ error: "start_time deve ser menor que end_time" });
  return next();
}

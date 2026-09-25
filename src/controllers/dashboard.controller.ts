import { Request, Response } from "express";
import { sequelize } from "../config/database";
import { QueryTypes } from "sequelize";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { ProfessionalModel } from "../models/Professional";

export const getDashboardKpis = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId)
    return res.status(401).json({ error: "Usuário não autenticado" });

  const professional = await ProfessionalModel.findOne({
    where: { user_id: userId },
  });
  if (!professional)
    return res
      .status(404)
      .json({ error: "Profissional não encontrado para este usuário" });
  const professionalId = professional.id;

  try {
    const sql = `
      SELECT
        COUNT(*) AS totalServices,
        COALESCE(SUM(COALESCE(a.final_price, s.price)), 0) AS totalEarnings,
        AVG(a.rating) AS avgRating
      FROM appointment a
      JOIN service s ON s.id = a.service_id
      WHERE a.professional_id = :id
        AND a.status = 'completed'
    `;

    const [results]: any = await sequelize.query(sql, {
      replacements: { id: professionalId },
      type: QueryTypes.SELECT,
    });

    return res.json({
      totalServices: Number(results.totalServices || 0),
      totalEarnings: parseFloat(String(results.totalEarnings || 0)),
      avgRating:
        results.avgRating !== null
          ? parseFloat(String(results.avgRating))
          : undefined,
    });
  } catch (error: any) {
    console.error("Error in getDashboardKpis:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export const getEarningsOverTime = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId)
    return res.status(401).json({ error: "Usuário não autenticado" });

  const professional = await ProfessionalModel.findOne({
    where: { user_id: userId },
  });
  if (!professional)
    return res
      .status(404)
      .json({ error: "Profissional não encontrado para este usuário" });
  const professionalId = professional.id;

  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setMonth(defaultFrom.getMonth() - 11);
    defaultFrom.setDate(1);

    const parseOrDefault = (d?: string, fallback?: Date) => {
      if (!d) return fallback;
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return fallback;
      return parsed;
    };

    const fromDate = parseOrDefault(from, defaultFrom)!;
    const toDate = parseOrDefault(to, now)!;

    // Sempre o profissional do token: aceitar ?professionalId= permitia
    // consultar os ganhos de qualquer outro profissional.
    const idToUse = professionalId;

    const fromReplacement = fromDate
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const toReplacement = toDate.toISOString().slice(0, 19).replace("T", " ");

    const dialect =
      (sequelize.getDialect && sequelize.getDialect()) ||
      process.env.SEQUELIZE_DIALECT ||
      "mysql";
    let monthExpr: string;
    if (dialect === "postgres" || dialect === "postgresql") {
      monthExpr = "to_char(a.completed_at, 'MM-YYYY')";
    } else {
      monthExpr = "DATE_FORMAT(a.completed_at, '%m-%Y')";
    }

    // Build SQL grouping by the same expression used in SELECT (monthExpr)
    // This avoids Postgres error: column "a.completed_at" must appear in the GROUP BY clause
    const finalSql = `
      SELECT ${monthExpr} AS month,
             SUM(COALESCE(a.final_price, s.price)) AS total
      FROM appointment a
      JOIN service s ON s.id = a.service_id
      WHERE a.professional_id = :id
        AND a.status = 'completed'
        AND a.completed_at IS NOT NULL
        AND a.completed_at BETWEEN :from AND :to
      GROUP BY ${monthExpr}
      ORDER BY MIN(a.completed_at)
    `;


    const results: any[] = await sequelize.query(finalSql, {
      replacements: {
        id: idToUse,
        from: fromReplacement,
        to: toReplacement,
      },
      type: QueryTypes.SELECT,
    });

    const mapped = results.map((r) => ({
      month: r.month,
      total: parseFloat(String(r.total || 0)),
    }));
    return res.json(mapped);
  } catch (error: any) {
    console.error("Error in getEarningsOverTime:", error?.stack || error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export const getServicesByCategory = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId)
    return res.status(401).json({ error: "Usuário não autenticado" });

  const professional = await ProfessionalModel.findOne({
    where: { user_id: userId },
  });
  if (!professional)
    return res
      .status(404)
      .json({ error: "Profissional não encontrado para este usuário" });
  const professionalId = professional.id;

  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setMonth(defaultFrom.getMonth() - 11);
    defaultFrom.setDate(1);

    const parseOrDefault = (d?: string, fallback?: Date) => {
      if (!d) return fallback;
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return fallback;
      return parsed;
    };

    const fromDate = parseOrDefault(from, defaultFrom)!;
    const toDate = parseOrDefault(to, now)!;

    const sql = `
      SELECT c.title AS category, COUNT(*) AS count
      FROM appointment a
      JOIN service s ON s.id = a.service_id
      JOIN subcategory sc ON sc.id = s.subcategory_id
      JOIN category c ON c.id = sc.category_id
      WHERE a.professional_id = :id
        AND a.status = 'completed'
        AND a.completed_at BETWEEN :from AND :to
      GROUP BY c.id, c.title
      ORDER BY count DESC
    `;

    const results: any[] = await sequelize.query(sql, {
      replacements: {
        id: professionalId,
        from: fromDate.toISOString().slice(0, 19).replace("T", " "),
        to: toDate.toISOString().slice(0, 19).replace("T", " "),
      },
      type: QueryTypes.SELECT,
    });

    const mapped = results.map((r) => ({
      category: r.category,
      count: Number(r.count),
    }));
    return res.json(mapped);
  } catch (error: any) {
    console.error("Error in getServicesByCategory:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

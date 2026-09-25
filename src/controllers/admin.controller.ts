import { Request, Response } from "express";
import { findUserByEmail, verifyPassword } from "../services/auth/credentials";
import { signToken } from "../utils/jwt.util";
import { UserModel } from "../models/User";
import { AdminModel } from "../models/Admin";
import { sequelize } from "../config/database";
import { QueryTypes } from "sequelize";

// Removidos imports não usados (AppointmentModel, ProfessionalModel, Op, Sequelize)

export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email e senha obrigatórios" });
  try {
    // Mesma resposta para e-mail inexistente e senha errada (evita enumerar contas).
    const normalized = String(email).trim().toLowerCase();
    const user = await findUserByEmail(normalized);
    const isValid = await verifyPassword(password, user?.password);
    if (!user || !isValid)
      return res.status(401).json({ error: "E-mail ou senha inválidos" });

    const isAdmin = await AdminModel.findOne({ where: { user_id: user.id } });
    if (!isAdmin)
      return res
        .status(403)
        .json({ error: "Apenas administradores têm acesso" });

    const payload = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      admin: true,
    } as any;

    const token = signToken(payload);

    return res
      .status(200)
      .json({
        token,
        user: { id: user.id, name: user.name, email: user.email, admin: true },
      });
  } catch (error: any) {
    console.error("Admin login error", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const usersSql = `
      SELECT EXTRACT(MONTH FROM created_at) AS month, COUNT(id) AS count
      FROM "users"
      WHERE EXTRACT(YEAR FROM created_at) = :year
      GROUP BY month
      ORDER BY month
    `;

    const professionalsSql = `
      SELECT EXTRACT(MONTH FROM created_at) AS month, COUNT(id) AS count
      FROM professional
      WHERE EXTRACT(YEAR FROM created_at) = :year
      GROUP BY month
      ORDER BY month
    `;

    const appointmentsSql = `
      SELECT EXTRACT(MONTH FROM created_at) AS month, status, COUNT(id) AS count
      FROM appointment
      WHERE EXTRACT(YEAR FROM created_at) = :year
      GROUP BY month, status
      ORDER BY month
    `;

    const servicesSummarySql = `
      SELECT status, COUNT(id) AS count
      FROM appointment
      WHERE EXTRACT(YEAR FROM created_at) = :year
      GROUP BY status
    `;

    const users: any[] = (await sequelize.query(usersSql, {
      replacements: { year },
      type: QueryTypes.SELECT,
    })) as any[];
    const professionals: any[] = (await sequelize.query(professionalsSql, {
      replacements: { year },
      type: QueryTypes.SELECT,
    })) as any[];
    const appointments: any[] = (await sequelize.query(appointmentsSql, {
      replacements: { year },
      type: QueryTypes.SELECT,
    })) as any[];
    const servicesSummaryRows: any[] = (await sequelize.query(
      servicesSummarySql,
      { replacements: { year }, type: QueryTypes.SELECT }
    )) as any[];

    const servicesSummary: Record<string, number> = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      canceled: 0,
      total: 0,
    };
    for (const row of servicesSummaryRows) {
      const status = String(row.status);
      servicesSummary[status] = Number(row.count || 0);
      servicesSummary.total += Number(row.count || 0);
    }

    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1 }));
    const usersByMonth = months.map((m) => ({
      month: m.month,
      count: Number(
        (users.find((u) => Number(u.month) === m.month) || { count: 0 }).count
      ),
    }));
    const professionalsByMonth = months.map((m) => ({
      month: m.month,
      count: Number(
        (professionals.find((p) => Number(p.month) === m.month) || { count: 0 })
          .count
      ),
    }));
    const appointmentsByMonth = months.map((m) => {
      const month = m.month;
      const pending = Number(
        (
          appointments.find(
            (a) => Number(a.month) === month && a.status === "pending"
          ) || { count: 0 }
        ).count || 0
      );
      const confirmed = Number(
        (
          appointments.find(
            (a) => Number(a.month) === month && a.status === "confirmed"
          ) || { count: 0 }
        ).count || 0
      );
      const completed = Number(
        (
          appointments.find(
            (a) => Number(a.month) === month && a.status === "completed"
          ) || { count: 0 }
        ).count || 0
      );
      const canceled = Number(
        (
          appointments.find(
            (a) => Number(a.month) === month && a.status === "canceled"
          ) || { count: 0 }
        ).count || 0
      );
      const totalRequested = pending + confirmed + completed + canceled;
      return { month, totalRequested, completed, canceled, pending, confirmed };
    });

    return res.json({
      year,
      usersByMonth,
      professionalsByMonth,
      appointmentsByMonth,
      servicesSummary,
    });
  } catch (error: any) {
    console.error("Admin stats error", error);
    return res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
};

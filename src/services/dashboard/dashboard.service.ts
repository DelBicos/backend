/**
 * Indicadores do profissional autenticado (dashboard / RF10).
 */
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/database";
import { ProfessionalModel } from "../../models/Professional";
import { HttpError } from "../../errors/HttpError";

export interface Period {
  from: Date;
  to: Date;
}

/** Periodo padrao: do dia 1 de 11 meses atras ate agora. Datas invalidas usam o padrao. */
export function resolvePeriod(
  query: { from?: unknown; to?: unknown },
  now: Date = new Date(),
): Period {
  const defaultFrom = new Date(now);
  defaultFrom.setMonth(defaultFrom.getMonth() - 11);
  defaultFrom.setDate(1);

  const parse = (value: unknown, fallback: Date) => {
    if (!value) return fallback;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? fallback : date;
  };

  const period = { from: parse(query.from, defaultFrom), to: parse(query.to, now) };
  if (period.from > period.to) {
    throw HttpError.badRequest("A data inicial deve ser anterior à data final");
  }
  return period;
}

/** Formato aceito por Postgres e MySQL em comparacoes com timestamp. */
export function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Expressao "MM-YYYY" para agrupar por mes conforme o dialeto. */
export function monthExpression(dialect: string): string {
  return dialect === "postgres"
    ? "to_char(a.completed_at, 'MM-YYYY')"
    : "DATE_FORMAT(a.completed_at, '%m-%Y')";
}

async function requireProfessionalId(userId: number): Promise<number> {
  const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });
  if (!professional) {
    throw HttpError.notFound("Profissional não encontrado para este usuário");
  }
  return professional.id;
}

export async function getKpis(userId: number) {
  const professionalId = await requireProfessionalId(userId);

  // Aliases em snake_case: o Postgres converte identificadores sem aspas para
  // minusculas, entao "totalServices" voltava como "totalservices" (KPI zerado).
  const [row]: any[] = await sequelize.query(
    `
      SELECT
        COUNT(*) AS total_services,
        COALESCE(SUM(COALESCE(a.final_price, s.price)), 0) AS total_earnings,
        AVG(a.rating) AS avg_rating
      FROM appointment a
      JOIN service s ON s.id = a.service_id
      WHERE a.professional_id = :id
        AND a.status = 'completed'
    `,
    { replacements: { id: professionalId }, type: QueryTypes.SELECT },
  );

  return {
    totalServices: Number(row?.total_services || 0),
    totalEarnings: parseFloat(String(row?.total_earnings || 0)),
    avgRating:
      row?.avg_rating !== null && row?.avg_rating !== undefined
        ? parseFloat(String(row.avg_rating))
        : undefined,
  };
}

export async function getEarningsOverTime(userId: number, query: { from?: unknown; to?: unknown }) {
  const professionalId = await requireProfessionalId(userId);
  const { from, to } = resolvePeriod(query);
  const month = monthExpression(sequelize.getDialect());

  const rows: any[] = await sequelize.query(
    `
      SELECT ${month} AS month,
             SUM(COALESCE(a.final_price, s.price)) AS total
      FROM appointment a
      JOIN service s ON s.id = a.service_id
      WHERE a.professional_id = :id
        AND a.status = 'completed'
        AND a.completed_at IS NOT NULL
        AND a.completed_at BETWEEN :from AND :to
      GROUP BY ${month}
      ORDER BY MIN(a.completed_at)
    `,
    {
      replacements: { id: professionalId, from: toSqlTimestamp(from), to: toSqlTimestamp(to) },
      type: QueryTypes.SELECT,
    },
  );

  return rows.map((r) => ({ month: r.month, total: parseFloat(String(r.total || 0)) }));
}

export async function getServicesByCategory(
  userId: number,
  query: { from?: unknown; to?: unknown },
) {
  const professionalId = await requireProfessionalId(userId);
  const { from, to } = resolvePeriod(query);

  const rows: any[] = await sequelize.query(
    `
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
    `,
    {
      replacements: { id: professionalId, from: toSqlTimestamp(from), to: toSqlTimestamp(to) },
      type: QueryTypes.SELECT,
    },
  );

  return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
}

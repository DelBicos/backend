/**
 * Indicadores do painel administrativo. Todos os numeros saem do banco:
 * nada de valor fixo. Uma consulta por assunto, agrupada por mes.
 */
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/database";
import { HttpError } from "../../errors/HttpError";

export const APPOINTMENT_STATUSES = [
  "pending",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
] as const;
type Status = (typeof APPOINTMENT_STATUSES)[number];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function parseYear(value: unknown): number {
  if (value === undefined || value === "") return new Date().getFullYear();
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw HttpError.badRequest("Ano inválido");
  }
  return year;
}

const query = <T>(sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;

/** Serie de 12 meses (jan..dez) a partir de linhas { month, value }. */
function byMonth(rows: { month: unknown; value: unknown }[]): number[] {
  const out = new Array(12).fill(0);
  for (const r of rows) {
    const m = Number(r.month);
    if (m >= 1 && m <= 12) out[m - 1] = Number(r.value) || 0;
  }
  return out;
}

export async function getStats(yearInput?: unknown) {
  const year = parseYear(yearInput);

  const [users, professionals, appointmentRows, revenueRows, totals, ratings, queues] =
    await Promise.all([
      query<{ month: number; value: number }>(
        `SELECT EXTRACT(MONTH FROM created_at) AS month, COUNT(id) AS value
         FROM users WHERE EXTRACT(YEAR FROM created_at) = :year GROUP BY month`,
        { year },
      ),
      query<{ month: number; value: number }>(
        `SELECT EXTRACT(MONTH FROM created_at) AS month, COUNT(id) AS value
         FROM professional WHERE EXTRACT(YEAR FROM created_at) = :year GROUP BY month`,
        { year },
      ),
      query<{ month: number; status: Status; value: number }>(
        `SELECT EXTRACT(MONTH FROM created_at) AS month, status::text AS status, COUNT(id) AS value
         FROM appointment WHERE EXTRACT(YEAR FROM created_at) = :year GROUP BY month, status`,
        { year },
      ),
      // Valor movimentado: servicos concluidos + valor retido em cancelamentos/no-show.
      query<{ month: number; value: number }>(
        `SELECT EXTRACT(MONTH FROM created_at) AS month,
                SUM(CASE WHEN status::text = 'completed' THEN COALESCE(final_price, 0)
                         ELSE COALESCE(retained_cents, 0) / 100.0 END) AS value
         FROM appointment
         WHERE EXTRACT(YEAR FROM created_at) = :year
           AND status::text IN ('completed', 'canceled', 'no_show')
         GROUP BY month`,
        { year },
      ),
      query<{ users: number; professionals: number; verified: number }>(
        `SELECT (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM professional) AS professionals,
                (SELECT COUNT(*) FROM professional WHERE identity_verified_at IS NOT NULL) AS verified`,
      ),
      query<{ average: number | null; count: number }>(
        `SELECT AVG(rating) AS average, COUNT(rating) AS count
         FROM appointment WHERE rating IS NOT NULL`,
      ),
      query<{ open_disputes: number; pending_verifications: number }>(
        `SELECT (SELECT COUNT(*) FROM dispute WHERE status = 'open') AS open_disputes,
                (SELECT COUNT(*) FROM identity_verification WHERE status = 'pending') AS pending_verifications`,
      ),
    ]);

  const statusByMonth = Object.fromEntries(
    APPOINTMENT_STATUSES.map((status) => [
      status,
      byMonth(appointmentRows.filter((r) => r.status === status)),
    ]),
  ) as Record<Status, number[]>;

  const statusTotals = Object.fromEntries(
    APPOINTMENT_STATUSES.map((s) => [s, statusByMonth[s].reduce((a, b) => a + b, 0)]),
  ) as Record<Status, number>;
  const appointmentsTotal = Object.values(statusTotals).reduce((a, b) => a + b, 0);

  const revenueByMonth = byMonth(revenueRows).map((v) => Math.round(v * 100) / 100);
  const average = ratings[0]?.average;

  return {
    year,
    kpis: {
      revenue: Math.round(revenueByMonth.reduce((a, b) => a + b, 0) * 100) / 100,
      appointments: appointmentsTotal,
      completed: statusTotals.completed,
      averageRating: average == null ? null : Math.round(Number(average) * 10) / 10,
      ratingsCount: Number(ratings[0]?.count ?? 0),
      totalUsers: Number(totals[0]?.users ?? 0),
      totalProfessionals: Number(totals[0]?.professionals ?? 0),
      verifiedProfessionals: Number(totals[0]?.verified ?? 0),
    },
    queues: {
      openDisputes: Number(queues[0]?.open_disputes ?? 0),
      pendingVerifications: Number(queues[0]?.pending_verifications ?? 0),
    },
    months: MONTHS,
    usersByMonth: byMonth(users),
    professionalsByMonth: byMonth(professionals),
    revenueByMonth,
    appointmentsByMonth: statusByMonth,
    statusTotals,
  };
}

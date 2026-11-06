import { HttpError } from "../../../errors/HttpError";

const query = jest.fn();
jest.mock("../../../config/database", () => ({ sequelize: { query: (...a: unknown[]) => query(...a) } }));

import { getStats, parseYear } from "../stats.service";

describe("parseYear", () => {
  it("usa o ano atual sem parametro e recusa valores invalidos", () => {
    expect(parseYear(undefined)).toBe(new Date().getFullYear());
    expect(parseYear("2025")).toBe(2025);
    expect(() => parseYear("abc")).toThrow(HttpError);
    expect(() => parseYear("1999")).toThrow(HttpError);
  });
});

describe("getStats", () => {
  it("monta series de 12 meses, totais por status e KPIs reais", async () => {
    query
      .mockResolvedValueOnce([{ month: "1", value: "3" }, { month: "3", value: "2" }]) // users
      .mockResolvedValueOnce([{ month: "3", value: "1" }]) // professionals
      .mockResolvedValueOnce([
        { month: "1", status: "completed", value: "4" },
        { month: "1", status: "canceled", value: "1" },
        { month: "2", status: "no_show", value: "2" },
        { month: "2", status: "pending", value: "3" },
      ])
      .mockResolvedValueOnce([{ month: "1", value: "250.505" }, { month: "2", value: "30" }]) // revenue
      .mockResolvedValueOnce([{ users: "10", professionals: "4", verified: "1" }])
      .mockResolvedValueOnce([{ average: "4.66", count: "7" }])
      .mockResolvedValueOnce([{ open_disputes: "2", pending_verifications: "5" }]);

    const stats = await getStats("2026");

    expect(stats.usersByMonth).toEqual([3, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(stats.appointmentsByMonth.completed[0]).toBe(4);
    expect(stats.appointmentsByMonth.no_show[1]).toBe(2);
    expect(stats.statusTotals).toEqual({
      pending: 3, confirmed: 0, completed: 4, canceled: 1, no_show: 2,
    });
    expect(stats.kpis).toMatchObject({
      revenue: 280.51,
      appointments: 10,
      completed: 4,
      averageRating: 4.7,
      ratingsCount: 7,
      totalUsers: 10,
      totalProfessionals: 4,
      verifiedProfessionals: 1,
    });
    expect(stats.queues).toEqual({ openDisputes: 2, pendingVerifications: 5 });
  });

  it("sem avaliacoes a media e nula (nunca um valor inventado)", async () => {
    query.mockReset();
    for (let i = 0; i < 4; i++) query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ average: null, count: "0" }]).mockResolvedValueOnce([]);
    const stats = await getStats();
    expect(stats.kpis.averageRating).toBeNull();
    expect(stats.kpis.revenue).toBe(0);
  });
});

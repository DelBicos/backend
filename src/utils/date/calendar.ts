import { MIN_ADVANCE_HOURS } from "../../constants/booking";
import { WEEKDAYS, normalizePortugueseText, normalizeWeekdayKey } from "./portugueseText";

export const DEFAULT_BOT_TIME_ZONE = "America/Sao_Paulo";

export type TimePeriod = "MORNING" | "AFTERNOON" | "EVENING";

export interface DateParseOptions {
  now?: Date;
  timeZone?: string;
}

export function resolveBotTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    return DEFAULT_BOT_TIME_ZONE;
  }
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_BOT_TIME_ZONE;
  }
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function getCalendarDateInTimeZone(date: Date, timeZone: string): CalendarDate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
    };
  } catch {
    const fallback = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_BOT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      fallback
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
    };
  }
}

export function toCalendarTimestamp(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export function fromCalendarTimestamp(timestamp: number): CalendarDate {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  return fromCalendarTimestamp(toCalendarTimestamp(date) + days * DAY_IN_MS);
}

export function isValidCalendarDate(date: CalendarDate): boolean {
  if (
    date.year < 1 ||
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1 ||
    date.day > 31
  ) {
    return false;
  }
  const parsed = fromCalendarTimestamp(toCalendarTimestamp(date));
  return (
    parsed.year === date.year &&
    parsed.month === date.month &&
    parsed.day === date.day
  );
}

export function formatIsoCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function normalizeYear(year: number): number {
  return year < 100 ? year + 2000 : year;
}

export function resolveYearlessDate(
  day: number,
  month: number,
  today: CalendarDate,
): CalendarDate | null {
  let candidate: CalendarDate = { year: today.year, month, day };
  if (!isValidCalendarDate(candidate)) return null;
  if (toCalendarTimestamp(candidate) < toCalendarTimestamp(today)) {
    candidate = { ...candidate, year: candidate.year + 1 };
  }
  return isValidCalendarDate(candidate) ? candidate : null;
}

export function resolveDayOnly(day: number, today: CalendarDate): CalendarDate | null {
  if (day < 1 || day > 31) return null;

  for (let offset = 0; offset <= 12; offset += 1) {
    const absoluteMonth = today.month - 1 + offset;
    const candidate: CalendarDate = {
      year: today.year + Math.floor(absoluteMonth / 12),
      month: (absoluteMonth % 12) + 1,
      day,
    };
    if (
      isValidCalendarDate(candidate) &&
      toCalendarTimestamp(candidate) >= toCalendarTimestamp(today)
    ) {
      return candidate;
    }
  }
  return null;
}

export function formatDatePtBR(date: string): string {
  const [year, month, day] = date.split("-");
  const months = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  return `${day}/${months[Number(month) - 1]}/${year}`;
}

export function timeZoneOffsetAt(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const zonedTimestamp = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return zonedTimestamp - date.getTime();
}

export function parseLocalAppointmentStart(
  date: string,
  time: string,
  timeZone = DEFAULT_BOT_TIME_ZONE,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.trim().slice(0, 5).split(":").map(Number);
  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  try {
    let utcTimestamp =
      localTimestamp - timeZoneOffsetAt(new Date(localTimestamp), timeZone);
    utcTimestamp =
      localTimestamp - timeZoneOffsetAt(new Date(utcTimestamp), timeZone);
    return new Date(utcTimestamp);
  } catch {
    const utcTimestamp =
      localTimestamp -
      timeZoneOffsetAt(new Date(localTimestamp), DEFAULT_BOT_TIME_ZONE);
    return new Date(utcTimestamp);
  }
}

export function parseIsoDate(date: string): CalendarDate | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValidCalendarDate(parsed) ? parsed : null;
}

/**
 * Resolve um dia da semana isolado contra as datas que o bot acabou de listar.
 * Expressões relativas como "próxima terça" ficam a cargo do parser de datas.
 */
export function selectSuggestedDateByWeekday(
  text: string,
  suggestedDates: string[],
): string | null {
  const normalized = normalizePortugueseText(text);
  const match = normalized.match(
    /^(?:(?:na|no|a)\s+)?(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab)(?:\s*-?\s*feira)?$/,
  );
  if (!match) return null;

  const requestedWeekday = WEEKDAYS[normalizeWeekdayKey(match[1])];
  for (const date of suggestedDates) {
    const parsed = parseIsoDate(date);
    if (
      parsed &&
      new Date(toCalendarTimestamp(parsed)).getUTCDay() === requestedWeekday
    ) {
      return date;
    }
  }
  return null;
}

export function isValidFutureDate(
  date: string,
  options: DateParseOptions = {},
): boolean {
  const parsed = parseIsoDate(date);
  if (!parsed) return false;
  const today = getCalendarDateInTimeZone(
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_BOT_TIME_ZONE,
  );
  return toCalendarTimestamp(parsed) >= toCalendarTimestamp(today);
}

export function isValidBookingDate(
  date: string,
  options: DateParseOptions = {},
): boolean {
  const parsed = parseIsoDate(date);
  if (!parsed) return false;
  // O dia so serve se ainda cabe um horario a partir de agora + antecedencia
  // minima; o horario exato e validado na criacao do agendamento.
  const earliest = new Date(
    (options.now ?? new Date()).getTime() + MIN_ADVANCE_HOURS * 3_600_000,
  );
  const minimumDate = getCalendarDateInTimeZone(
    earliest,
    options.timeZone ?? DEFAULT_BOT_TIME_ZONE,
  );
  return toCalendarTimestamp(parsed) >= toCalendarTimestamp(minimumDate);
}

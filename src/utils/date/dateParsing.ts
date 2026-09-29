import { DEFAULT_BOT_TIME_ZONE, addCalendarDays, formatIsoCalendarDate, getCalendarDateInTimeZone, isValidCalendarDate, normalizeYear, resolveDayOnly, resolveYearlessDate, toCalendarTimestamp } from "./calendar";
import type { DateParseOptions } from "./calendar";
import { MONTHS, WEEKDAYS, normalizePortugueseText, normalizeWeekdayKey, replaceNumberWords } from "./portugueseText";

export function parsePortugueseDate(
  text: string,
  options: DateParseOptions = {},
): string | null {
  const normalizedOriginal = normalizePortugueseText(text);
  const normalized = replaceNumberWords(normalizedOriginal);
  const today = getCalendarDateInTimeZone(
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_BOT_TIME_ZONE,
  );

  const addDays = (days: number) =>
    formatIsoCalendarDate(addCalendarDays(today, days));

  if (
    /\b(?:depois|dps)\s+(?:de|d)\s+(?:amanha|amanh|amnh)\b/.test(normalized)
  ) {
    return addDays(2);
  }
  if (/\b(?:amanha|amanh|amnh)\b/.test(normalized)) return addDays(1);
  if (/\b(?:hoje|hj)\b/.test(normalized)) return addDays(0);

  const nextWeekWeekdayMatch =
    normalizedOriginal.match(
      /\b(?:proxim[oa]|prox)\.?\s+(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab|[2-6](?=\s*-?\s*feira\b))(?:\s*-?\s*feira)?\b/,
    ) ??
    normalizedOriginal.match(
      /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab|[2-6](?=\s*-?\s*feira\b))(?:\s*-?\s*feira)?\s+proxim[oa]\b/,
    ) ??
    normalizedOriginal.match(
      /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab|[2-6](?=\s*-?\s*feira\b))(?:\s*-?\s*feira)?\s+(?:da|de)\s+(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)\b/,
    ) ??
    normalizedOriginal.match(
      /\b(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)(?:\s+(?:na|de))?\s+(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab|[2-6](?=\s*-?\s*feira\b))(?:\s*-?\s*feira)?\b/,
    );
  const weekdayMatch =
    nextWeekWeekdayMatch ??
    normalizedOriginal.match(
      /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabad+o+|sab|[2-6](?=\s*-?\s*feira\b))(?:\s*-?\s*feira)?(?:\s+(?:que|q)\s+vem)?\b/,
    );
  if (weekdayMatch) {
    const targetWeekday = WEEKDAYS[normalizeWeekdayKey(weekdayMatch[1])];
    const currentWeekday = new Date(toCalendarTimestamp(today)).getUTCDay();
    let difference: number;
    if (nextWeekWeekdayMatch) {
      const currentMondayIndex = (currentWeekday + 6) % 7;
      const targetMondayIndex = (targetWeekday + 6) % 7;
      difference = 7 - currentMondayIndex + targetMondayIndex;
    } else {
      difference = targetWeekday - currentWeekday;
      if (difference <= 0) difference += 7;
    }
    return addDays(difference);
  }

  const isoMatch = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const candidate = {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
    return isValidCalendarDate(candidate)
      ? formatIsoCalendarDate(candidate)
      : null;
  }

  const numericMatch = normalized.match(
    /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?\b/,
  );
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const candidate = numericMatch[3]
      ? { year: normalizeYear(Number(numericMatch[3])), month, day }
      : resolveYearlessDate(day, month, today);
    return candidate && isValidCalendarDate(candidate)
      ? formatIsoCalendarDate(candidate)
      : null;
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const writtenMatch = normalized.match(
    new RegExp(
      `\\b(?:dia\\s+)?(\\d{1,2})\\s+(?:de|do|da)\\s+(${monthNames}|\\d{1,2})(?:\\s+(?:de|do)\\s+(\\d{2,4}))?\\b`,
    ),
  );
  if (writtenMatch) {
    const day = Number(writtenMatch[1]);
    const month = MONTHS[writtenMatch[2]] ?? Number(writtenMatch[2]);
    const candidate = writtenMatch[3]
      ? { year: normalizeYear(Number(writtenMatch[3])), month, day }
      : resolveYearlessDate(day, month, today);
    return candidate && isValidCalendarDate(candidate)
      ? formatIsoCalendarDate(candidate)
      : null;
  }

  const dayOnlyMatch = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnlyMatch) {
    const candidate = resolveDayOnly(Number(dayOnlyMatch[1]), today);
    return candidate ? formatIsoCalendarDate(candidate) : null;
  }

  return null;
}

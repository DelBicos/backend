import type { TimePeriod } from "./calendar";
import { normalizePortugueseText, replaceNumberWords } from "./portugueseText";

export function applyPeriodToHour(hour: number, period: TimePeriod | null): number {
  if (
    (period === "AFTERNOON" || period === "EVENING") &&
    hour >= 1 &&
    hour <= 11
  ) {
    return hour + 12;
  }
  if (period === "MORNING" && hour === 12) return 0;
  return hour;
}

export function parseTimePeriodFromText(text: string): TimePeriod | null {
  const normalized = normalizePortugueseText(text);
  if (
    /\b(?:de|da|pela|na)?\s*(?:manha|matutino|matutina|cedo|manhazinha)\b/.test(
      normalized,
    )
  ) {
    return "MORNING";
  }
  if (
    /\b(?:de|da|pela|na|a)?\s*(?:tarde|vespertino|vespertina|fim da tarde)\b/.test(
      normalized,
    )
  ) {
    return "AFTERNOON";
  }
  if (
    /\b(?:de|da|pela|na|a)?\s*(?:noite|noturno|noturna|anoitecer)\b/.test(
      normalized,
    )
  ) {
    return "EVENING";
  }
  return null;
}

export function formatTimePeriodPtBR(period: TimePeriod): string {
  if (period === "MORNING") return "da manhã";
  if (period === "AFTERNOON") return "da tarde";
  return "da noite";
}

export function isTimeInPeriod(time: string, period: TimePeriod): boolean {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (period === "MORNING") return minutes >= 6 * 60 && minutes < 12 * 60;
  if (period === "AFTERNOON") return minutes >= 12 * 60 && minutes < 18 * 60;
  return minutes >= 18 * 60 && minutes < 24 * 60;
}

export function filterTimesByPeriod(
  times: string[],
  period: TimePeriod,
): string[] {
  return times.filter((time) => isTimeInPeriod(time, period));
}

export function parseTimeFromText(text: string): string | null {
  const normalized = replaceNumberWords(normalizePortugueseText(text));
  const period = parseTimePeriodFromText(text);

  if (/\bmeio\s*-?\s*dia\b/.test(normalized)) {
    if (/\b(?:e\s+)?meia\b/.test(normalized)) return "12:30";
    if (/\be\s+(?:15|um quarto)\b/.test(normalized)) return "12:15";
    if (/\be\s+45\b/.test(normalized)) return "12:45";
    return "12:00";
  }

  if (/\bmeia\s*-?\s*noite\b/.test(normalized)) {
    if (/\b(?:e\s+)?meia\b/.test(normalized)) return "00:30";
    if (/\be\s+(?:15|um quarto)\b/.test(normalized)) return "00:15";
    if (/\be\s+45\b/.test(normalized)) return "00:45";
    return "00:00";
  }

  const beforeHour = normalized.match(
    /\b(\d{1,2})\s*(?:minutos?\s*)?(?:para|pras?|p\/?)\s+(?:as\s+)?(\d{1,2})\b/,
  );
  if (beforeHour) {
    const minutesBefore = Number(beforeHour[1]);
    let targetHour = applyPeriodToHour(Number(beforeHour[2]), period);
    if (
      minutesBefore >= 1 &&
      minutesBefore <= 59 &&
      targetHour >= 0 &&
      targetHour <= 23
    ) {
      targetHour = (targetHour + 23) % 24;
      return `${String(targetHour).padStart(2, "0")}:${String(60 - minutesBefore).padStart(2, "0")}`;
    }
  }

  const numeric = normalized.match(
    /\b(?:as\s+|por\s+volta\s+d(?:e|as?)\s+)?(\d{1,2})(?:\s*(?::|h|\.)\s*(\d{1,2}))\s*(?:h|horas?)?\b/,
  );
  if (numeric) {
    const hour = applyPeriodToHour(Number(numeric[1]), period);
    const minute = Number(numeric[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const hourWithMinutes = normalized.match(
    /\b(?:as\s+|por\s+volta\s+d(?:e|as?)\s+)?(\d{1,2})\s+e\s+(meia|um quarto|\d{1,2})\b/,
  );
  if (hourWithMinutes) {
    const minuteMap: Record<string, number> = {
      meia: 30,
      "15": 15,
      "30": 30,
      "45": 45,
      "um quarto": 15,
    };
    const hour = applyPeriodToHour(Number(hourWithMinutes[1]), period);
    const minute = minuteMap[hourWithMinutes[2]] ?? Number(hourWithMinutes[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const hourOnly = normalized.match(
    /\b(?:as\s+|por\s+volta\s+d(?:e|as?)\s+)?(\d{1,2})\s*(?:h|horas?|em ponto)\b|\bas\s+(\d{1,2})\b/,
  );
  if (hourOnly) {
    const hour = applyPeriodToHour(Number(hourOnly[1] ?? hourOnly[2]), period);
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:00`;
    }
  }

  const hourWithPeriod = normalized.match(
    /\b(\d{1,2})\s*(?:da|de|pela|na|a)\s+(?:manha|tarde|noite)\b/,
  );
  if (hourWithPeriod && period) {
    const hour = applyPeriodToHour(Number(hourWithPeriod[1]), period);
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:00`;
    }
  }

  const amPm = normalized.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (amPm) {
    let hour = Number(amPm[1]);
    if (hour >= 1 && hour <= 12) {
      if (amPm[2] === "pm" && hour !== 12) hour += 12;
      if (amPm[2] === "am" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:00`;
    }
  }

  return null;
}

/**
 * Resolve uma hora em formato de 12 horas usando o período da conversa e os
 * horários disponíveis no dia.
 *
 * Exemplo: "seis horas" é inicialmente 06:00. Se 06:00 não estiver na lista,
 * mas 18:00 estiver, o contexto permite interpretar a intenção como 18:00.
 * Sem um equivalente exato, horas de 1 a 5 usam o período comercial mais
 * provável (13:00 a 17:59), então "duas e meia" significa 14:30, e não 02:30.
 * Horários explícitos (06:00, 6h, AM/PM ou com período) nunca são alterados.
 */
export function resolveAmbiguousTimeFromAvailableSlots(
  text: string,
  parsedTime: string,
  availableTimes: string[],
  preferredPeriod?: TimePeriod | null,
): string {
  const timeMatch = parsedTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return parsedTime;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour < 1 || hour > 11 || minute < 0 || minute > 59) {
    return parsedTime;
  }

  if (parseTimePeriodFromText(text)) return parsedTime;

  const normalized = replaceNumberWords(normalizePortugueseText(text));
  const hasExplicitClockFormat =
    /\b\d{1,2}\s*(?::|\.)\s*\d{1,2}\b/.test(normalized) ||
    /\b\d{1,2}\s*h(?:\s*\d{1,2})?\b/.test(normalized) ||
    /\b\d{1,2}\s*(?:am|pm)\b/.test(normalized);
  if (hasExplicitClockFormat) return parsedTime;

  const normalizedParsed = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const afternoonEquivalent = `${String(hour + 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  if (preferredPeriod === "AFTERNOON" || preferredPeriod === "EVENING") {
    return afternoonEquivalent;
  }
  if (preferredPeriod === "MORNING") return normalizedParsed;

  const normalizeAvailableTime = (value: string): string | null => {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  };
  const available = new Set(
    availableTimes
      .map(normalizeAvailableTime)
      .filter((value): value is string => value !== null),
  );
  const hasMorningEquivalent = available.has(normalizedParsed);
  const hasAfternoonEquivalent = available.has(afternoonEquivalent);
  if (hasMorningEquivalent !== hasAfternoonEquivalent) {
    return hasAfternoonEquivalent ? afternoonEquivalent : normalizedParsed;
  }

  // Em conversas sobre atendimento, 01h–05h sem período quase sempre quer
  // dizer 13h–17h. Isso também evita afirmar que o cliente pediu um horário
  // de madrugada só porque o equivalente da tarde está indisponível.
  if (hour <= 5) return afternoonEquivalent;

  const availableHours = Array.from(available, (value) =>
    Number(value.slice(0, 2)),
  );
  const hasMorningAvailability = availableHours.some((value) => value < 12);
  const hasAfternoonAvailability = availableHours.some((value) => value >= 12);
  if (hour >= 7 && !hasMorningAvailability && hasAfternoonAvailability) {
    return afternoonEquivalent;
  }

  return normalizedParsed;
}

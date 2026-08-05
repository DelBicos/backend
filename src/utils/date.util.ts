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

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const NUMBER_WORDS: ReadonlyArray<readonly [string, number]> = [
  ["trinta e um", 31],
  ["vinte e nove", 29],
  ["vinte e oito", 28],
  ["vinte e sete", 27],
  ["vinte e seis", 26],
  ["vinte e cinco", 25],
  ["vinte e quatro", 24],
  ["vinte e tres", 23],
  ["vinte e dois", 22],
  ["vinte e um", 21],
  ["dezenove", 19],
  ["dezoito", 18],
  ["dezessete", 17],
  ["dezesseis", 16],
  ["quinze", 15],
  ["quatorze", 14],
  ["catorze", 14],
  ["treze", 13],
  ["doze", 12],
  ["onze", 11],
  ["trinta", 30],
  ["vinte", 20],
  ["dez", 10],
  ["nove", 9],
  ["oito", 8],
  ["sete", 7],
  ["seis", 6],
  ["cinco", 5],
  ["quatro", 4],
  ["tres", 3],
  ["duas", 2],
  ["dois", 2],
  ["primeiro", 1],
  ["uma", 1],
  ["um", 1],
  ["zero", 0],
];

const MONTHS: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  dom: 0,
  segunda: 1,
  seg: 1,
  "2": 1,
  terca: 2,
  ter: 2,
  "3": 2,
  quarta: 3,
  qua: 3,
  "4": 3,
  quinta: 4,
  qui: 4,
  "5": 4,
  sexta: 5,
  sex: 5,
  "6": 5,
  sabado: 6,
  sab: 6,
};

function normalizePortugueseText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ªº]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceNumberWords(text: string): string {
  let normalized = text;
  for (const [word, value] of NUMBER_WORDS) {
    normalized = normalized.replace(
      new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "g"),
      String(value),
    );
  }
  return normalized;
}

function getCalendarDateInTimeZone(
  date: Date,
  timeZone: string,
): CalendarDate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
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
      fallback.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
    };
  }
}

function toCalendarTimestamp(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromCalendarTimestamp(timestamp: number): CalendarDate {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  return fromCalendarTimestamp(toCalendarTimestamp(date) + days * DAY_IN_MS);
}

function isValidCalendarDate(date: CalendarDate): boolean {
  if (date.year < 1 || date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) {
    return false;
  }
  const parsed = fromCalendarTimestamp(toCalendarTimestamp(date));
  return parsed.year === date.year && parsed.month === date.month && parsed.day === date.day;
}

function formatIsoCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function normalizeYear(year: number): number {
  return year < 100 ? year + 2000 : year;
}

function resolveYearlessDate(
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

function resolveDayOnly(day: number, today: CalendarDate): CalendarDate | null {
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
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${day}/${months[Number(month) - 1]}/${year}`;
}

function timeZoneOffsetAt(date: Date, timeZone: string): number {
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
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
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
    let utcTimestamp = localTimestamp - timeZoneOffsetAt(new Date(localTimestamp), timeZone);
    utcTimestamp = localTimestamp - timeZoneOffsetAt(new Date(utcTimestamp), timeZone);
    return new Date(utcTimestamp);
  } catch {
    const utcTimestamp = localTimestamp - timeZoneOffsetAt(
      new Date(localTimestamp),
      DEFAULT_BOT_TIME_ZONE,
    );
    return new Date(utcTimestamp);
  }
}

function parseIsoDate(date: string): CalendarDate | null {
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
    /^(?:(?:na|no|a)\s+)?(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab)(?:\s*-?\s*feira)?$/,
  );
  if (!match) return null;

  const requestedWeekday = WEEKDAYS[match[1]];
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
  const today = getCalendarDateInTimeZone(
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_BOT_TIME_ZONE,
  );
  const minimumDate = addCalendarDays(today, 2);
  return toCalendarTimestamp(parsed) >= toCalendarTimestamp(minimumDate);
}

function applyPeriodToHour(hour: number, period: TimePeriod | null): number {
  if ((period === "AFTERNOON" || period === "EVENING") && hour >= 1 && hour <= 11) {
    return hour + 12;
  }
  if (period === "MORNING" && hour === 12) return 0;
  return hour;
}

export function parseTimePeriodFromText(text: string): TimePeriod | null {
  const normalized = normalizePortugueseText(text);
  if (/\b(?:de|da|pela|na)?\s*(?:manha|matutino|matutina|cedo|manhazinha)\b/.test(normalized)) {
    return "MORNING";
  }
  if (/\b(?:de|da|pela|na|a)?\s*(?:tarde|vespertino|vespertina|fim da tarde)\b/.test(normalized)) {
    return "AFTERNOON";
  }
  if (/\b(?:de|da|pela|na|a)?\s*(?:noite|noturno|noturna|anoitecer)\b/.test(normalized)) {
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
    if (minutesBefore >= 1 && minutesBefore <= 59 && targetHour >= 0 && targetHour <= 23) {
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
    /\b(?:as\s+|por\s+volta\s+d(?:e|as?)\s+)?(\d{1,2})\s+e\s+(meia|15|30|45|um quarto)\b/,
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
    const minute = minuteMap[hourWithMinutes[2]];
    if (hour >= 0 && hour <= 23) {
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
    /\b(\d{1,2})\s*(?:da|de|pela)\s+(?:manha|tarde|noite)\b/,
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

export function parsePortugueseDate(
  text: string,
  options: DateParseOptions = {},
): string | null {
  const normalized = replaceNumberWords(normalizePortugueseText(text));
  const today = getCalendarDateInTimeZone(
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_BOT_TIME_ZONE,
  );

  const addDays = (days: number) => formatIsoCalendarDate(addCalendarDays(today, days));

  if (/\b(?:depois|dps)\s+(?:de|d)\s+(?:amanha|amanh|amnh)\b/.test(normalized)) {
    return addDays(2);
  }
  if (/\b(?:amanha|amanh|amnh)\b/.test(normalized)) return addDays(1);
  if (/\b(?:hoje|hj)\b/.test(normalized)) return addDays(0);

  const nextWeekWeekdayMatch =
    normalized.match(
      /\b(?:proxima|prox)\.?\s+(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab|[2-6])(?:\s*-?\s*feira)?\b/,
    ) ??
    normalized.match(
      /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab|[2-6])(?:\s*-?\s*feira)?\s+proxima\b/,
    ) ??
    normalized.match(
      /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab|[2-6])(?:\s*-?\s*feira)?\s+(?:da|de)\s+(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)\b/,
    ) ??
    normalized.match(
      /\b(?:proxima\s+semana|semana\s+(?:que|q)\s+vem)(?:\s+(?:na|de))?\s+(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab|[2-6])(?:\s*-?\s*feira)?\b/,
    );
  const weekdayMatch = nextWeekWeekdayMatch ?? normalized.match(
    /\b(domingo|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sab|[2-6])(?:\s*-?\s*feira)?(?:\s+(?:que|q)\s+vem)?\b/,
  );
  if (weekdayMatch) {
    const targetWeekday = WEEKDAYS[weekdayMatch[1]];
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
    return isValidCalendarDate(candidate) ? formatIsoCalendarDate(candidate) : null;
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

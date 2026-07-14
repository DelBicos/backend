export function formatDatePtBR(date: string): string {
  const [year, month, day] = date.split("-");
  const months = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${day}/${months[Number(month) - 1]}/${year}`;
}

const BRAZIL_UTC_OFFSET_HOURS = 3;

export function parseLocalAppointmentStart(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.trim().slice(0, 5).split(":").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour + BRAZIL_UTC_OFFSET_HOURS, minute, 0, 0),
  );
}

export function isValidFutureDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date + "T00:00:00") >= today;
}

export function parseTimeFromText(text: string): string | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const wordToNum: Record<string, number> = {
    zero: 0, uma: 1, um: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
    cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
    quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
    dezenove: 19, vinte: 20, "vinte e um": 21, "vinte e dois": 22,
    "vinte e tres": 23,
  };

  const minuteWords: Record<string, number> = {
    zero: 0, "e meia": 30, "e quinze": 15, "e um quarto": 15,
    "e quarenta e cinco": 45, "e trinta": 30,
  };

  const isTarde = /\b(tarde|da tarde|a tarde)\b/.test(t);
  const isNoite = /\b(noite|da noite|a noite)\b/.test(t);
  const isManha = /\b(manha|da manha|a manha|manha cedo)\b/.test(t);

  if (/\b(meio.?dia)\b/.test(t)) {
    if (/e meia/.test(t)) return "12:30";
    if (/e quinze/.test(t) || /e um quarto/.test(t)) return "12:15";
    if (/e quarenta e cinco/.test(t)) return "12:45";
    return "12:00";
  }

  if (/\b(meia.?noite)\b/.test(t)) {
    if (/e meia/.test(t)) return "00:30";
    if (/e quinze/.test(t) || /e um quarto/.test(t)) return "00:15";
    if (/e quarenta e cinco/.test(t)) return "00:45";
    return "00:00";
  }

  const matchHoraE = t.match(/\b(\d{1,2}|[a-z]+)\s*(?:horas|h|:|e)\s*(\d{1,2}|[a-z]+(?:\s+e\s+[a-z]+)*)\b/);
  const matchHora = t.match(/\b(\d{1,2}|[a-z]+)\s*(?:horas|h|em ponto|da manhã|da tarde|da noite)?\b/);
  
  if (matchHoraE || matchHora) {
    let hourStr = "";
    let minStr = "";

    if (matchHoraE) {
      hourStr = matchHoraE[1];
      minStr = matchHoraE[2];
    } else if (matchHora) {
      hourStr = matchHora[1];
      minStr = "0";
    }

    let hour = parseInt(hourStr, 10);
    if (isNaN(hour)) {
      hour = wordToNum[hourStr];
    }
    if (hour === undefined) return null;

    let minute = parseInt(minStr, 10);
    if (isNaN(minute)) {
      if (wordToNum[minStr] !== undefined) minute = wordToNum[minStr];
      else if (minuteWords[minStr] !== undefined) minute = minuteWords[minStr];
      else minute = 0;
    }

    if (isTarde && hour >= 1 && hour <= 11) hour += 12;
    if (isNoite && hour >= 1 && hour <= 11) hour += 12;
    if (isManha && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const numericMatch = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (numericMatch) {
    let hour = parseInt(numericMatch[1], 10);
    let minute = parseInt(numericMatch[2], 10);
    if (isTarde && hour >= 1 && hour <= 11) hour += 12;
    if (isNoite && hour >= 1 && hour <= 11) hour += 12;
    if (isManha && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  return null;
}

export function parsePortugueseDate(text: string): string | null {
  const lower = text.toLowerCase().trim();
  const today = new Date();
  const currentYear = today.getFullYear();

  const wordNumbers: Record<string, number> = {
    primeiro: 1, um: 1, dois: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    treze: 13, treza: 13,
    quatorze: 14, catorze: 14, quatorza: 14,
    quinze: 15, quinza: 15,
    dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
    "vinte e um": 21, "vinte e dois": 22, "vinte e três": 23, "vinte e quatro": 24,
    "vinte e cinco": 25, "vinte e seis": 26, "vinte e sete": 27,
    "vinte e oito": 28, "vinte e dezenove": 29, "vinte e nove": 29,
    trinta: 30, "trinta e um": 31
  };

  const monthsMap: Record<string, number> = {
    janeiro: 1, jan: 1,
    fevereiro: 2, fev: 2,
    março: 3, marco: 3, mar: 3,
    abril: 4, abr: 4,
    maio: 5, mai: 5,
    junho: 6, jun: 6,
    julho: 7, jul: 7,
    agosto: 8, ago: 8,
    setembro: 9, set: 9,
    outubro: 10, out: 10,
    novembro: 11, nov: 11,
    dezembro: 12, dez: 12
  };

  let normalized = lower;
  const sortedWordNumbersKeys = Object.keys(wordNumbers).sort((a, b) => b.length - a.length);
  for (const word of sortedWordNumbersKeys) {
    const num = wordNumbers[word];
    const regex = new RegExp(`\\b${word}\\b`, "g");
    normalized = normalized.replace(regex, String(num));
  }

  const matchDmy = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (matchDmy) {
    let day = parseInt(matchDmy[1], 10);
    let month = parseInt(matchDmy[2], 10);
    let year = parseInt(matchDmy[3], 10);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const matchDm = normalized.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (matchDm) {
    let day = parseInt(matchDm[1], 10);
    let month = parseInt(matchDm[2], 10);
    let year = currentYear;
    const parsedDate = new Date(year, month - 1, day);
    if (parsedDate < today) year += 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const matchExt = normalized.match(/\b(?:dia\s+)?(\d{1,2})\s+(?:de|do|da)\s+([a-zçáéíóú\d]+)(?:\s+de\s+(\d{2,4}))?\b/);
  if (matchExt) {
    const day = parseInt(matchExt[1], 10);
    const monthStr = matchExt[2];
    
    let month = monthsMap[monthStr];
    if (!month && /^\d{1,2}$/.test(monthStr)) {
      month = parseInt(monthStr, 10);
    }
    
    if (month && month >= 1 && month <= 12) {
      let year = matchExt[3] ? parseInt(matchExt[3], 10) : currentYear;
      if (matchExt[3] && year < 100) year += 2000;
      if (!matchExt[3]) {
        const parsedDate = new Date(year, month - 1, day);
        if (parsedDate < today) year += 1;
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const matchOnlyDay = normalized.match(/^(?:dia\s+)?(\d{1,2})$/i);
  if (matchOnlyDay) {
    const day = parseInt(matchOnlyDay[1], 10);
    if (day >= 1 && day <= 31) {
      let month = today.getMonth() + 1;
      let year = currentYear;
      const parsedDate = new Date(year, month - 1, day);
      if (parsedDate < today) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

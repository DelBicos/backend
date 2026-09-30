/** Converte "HH:MM" ou "HH:MM:SS" para minutos desde meia-noite */
export function timeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return h * 60 + m;
}

const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface AvailabilityInput {
  day: number;
  start: string;
  end: string;
}

export interface AvailabilityError {
  index: number;
  message: string;
}

/**
 * Valida um array de disponibilidades e retorna lista de erros.
 * Se não houver erros, retorna array vazio.
 */
export function validateAvailabilities(items: unknown[]): AvailabilityError[] {
  const errors: AvailabilityError[] = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];

    if (typeof raw !== "object" || raw === null) {
      errors.push({ index: i, message: "Item inválido (deve ser objeto)" });
      continue;
    }
    const item = raw as Record<string, unknown>;

    const day = Number(item.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.push({
        index: i,
        message: "day deve ser inteiro entre 0 (Domingo) e 6 (Sábado)",
      });
    }

    if (typeof item.start !== "string" || !HH_MM_REGEX.test(item.start)) {
      errors.push({ index: i, message: "start deve estar no formato HH:MM" });
      continue;
    }

    if (typeof item.end !== "string" || !HH_MM_REGEX.test(item.end)) {
      errors.push({ index: i, message: "end deve estar no formato HH:MM" });
      continue;
    }

    if (timeToMinutes(item.start) >= timeToMinutes(item.end)) {
      errors.push({ index: i, message: "start deve ser anterior a end" });
    }
  }

  if (errors.length > 0) return errors;

  // Verificar sobreposição de ranges para o mesmo dia
  const valid = items as AvailabilityInput[];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      if (valid[i].day !== valid[j].day) continue;
      const s1 = timeToMinutes(valid[i].start);
      const e1 = timeToMinutes(valid[i].end);
      const s2 = timeToMinutes(valid[j].start);
      const e2 = timeToMinutes(valid[j].end);
      if (s1 < e2 && s2 < e1) {
        errors.push({
          index: j,
          message: `Sobreposição de horário no dia ${valid[j].day} com o item ${i}`,
        });
      }
    }
  }

  return errors;
}

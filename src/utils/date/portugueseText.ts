export const NUMBER_WORDS: ReadonlyArray<readonly [string, number]> = [
  ["quarenta e cinco", 45],
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

// Palavras de dia por extenso, na ordem em que aparecem em NUMBER_WORDS, para
// reuso em padrões que reconhecem uma data isolada (ex.: STANDALONE_DAY_PATTERN).
export const PORTUGUESE_DAY_WORDS: readonly string[] = NUMBER_WORDS.map(
  ([word]) => word,
);

export const MONTHS: Record<string, number> = {
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

export const WEEKDAYS: Record<string, number> = {
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

export function normalizePortugueseText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ªº]/g, "")
    .replace(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)-?feira\b/g, "$1 feira")
    .replace(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)feira\b/g, "$1 feira")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWeekdayKey(value: string): string {
  return value.replace(/^sabad+o+$/, "sabado");
}

export function replaceNumberWords(text: string): string {
  let normalized = text;
  for (const [word, value] of NUMBER_WORDS) {
    normalized = normalized.replace(
      new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "g"),
      String(value),
    );
  }
  return normalized;
}

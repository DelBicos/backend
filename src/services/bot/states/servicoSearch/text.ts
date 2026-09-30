import { stringSimilarity } from "../../../../utils/nlp.util";
import { canonicalizeServiceToken } from "../../serviceChoice.helpers";
import type { ServiceQueryAnalysis } from "./types";

export const SERVICE_SEARCH_STOP_WORDS = new Set([
  "a",
  "agendar",
  "agendamento",
  "alguem",
  "ao",
  "aos",
  "as",
  "atendimento",
  "busco",
  "buscar",
  "chamar",
  "com",
  "contratar",
  "contratacao",
  "da",
  "das",
  "de",
  "desejo",
  "do",
  "dos",
  "e",
  "em",
  "encontrar",
  "esta",
  "estou",
  "eu",
  "fazer",
  "favor",
  "gentileza",
  "gostaria",
  "aqui",
  "marcar",
  "marcacao",
  "marcao",
  "meu",
  "minha",
  "na",
  "nas",
  "necessito",
  "necessita",
  "no",
  "nos",
  "o",
  "obter",
  "os",
  "para",
  "pedir",
  "pedido",
  "pfv",
  "pode",
  "podem",
  "poderia",
  "por",
  "porfavor",
  "pra",
  "precisa",
  "precisando",
  "preciso",
  "procuro",
  "procurar",
  "que",
  "queria",
  "quero",
  "reservar",
  "reserva",
  "servico",
  "servicos",
  "solicitar",
  "solicitacao",
  "um",
  "uma",
  "urgente",
]);

/**
 * Equivalências pequenas e específicas do catálogo. Elas cobrem formas
 * profissionais e erros comuns sem transformar qualquer prefixo parecido em
 * uma correspondência (por exemplo, "montanha" não é "montagem").
 */
export const SERVICE_TOKEN_ALIASES = new Map<string, string>([
  ["barbeiro", "barba"],
  ["barbeiros", "barba"],
  ["jardineiro", "jardim"],
  ["jardineiros", "jardim"],
  ["jardineio", "jardim"],
  ["jardinagem", "jardim"],
  ["chaverio", "chaveiro"],
  ["faxineira", "diarista"],
  ["faxineiras", "diarista"],
  ["faxineiro", "diarista"],
  ["faxineiros", "diarista"],
  ["montagen", "montagem"],
  ["montador", "montagem"],
  ["montadores", "montagem"],
  ["montar", "montagem"],
  ["pintar", "pintor"],
  ["pintura", "pintor"],
  ["vidraca", "vidro"],
  ["vidracas", "vidro"],
  ["vazando", "vazamento"],
]);

export const GENERIC_SERVICE_ACTION_TOKENS = new Set([
  "consertar",
  "conserto",
  "desentupidor",
  "desentupir",
  "instalacao",
  "instalar",
  "limpar",
  "limpeza",
  "manutencao",
  "montagem",
  "reformar",
  "reforma",
  "reparar",
  "reparo",
  "troca",
  "trocar",
]);


export function normalizeServiceSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalServiceToken(token: string): string {
  // "cabeleleiro" (erro relatado), "cabeleireiro", "cabelereiro" e
  // flexões de cabelo pertencem à mesma família. O prefixo completo "cabel"
  // evita confundir com "cabeamento".
  if (/^cabel/.test(token)) return "cabelo";
  return canonicalizeServiceToken(SERVICE_TOKEN_ALIASES.get(token) ?? token);
}

export function serviceSearchTokens(value: string): string[] {
  return normalizeServiceSearchText(value)
    .split(" ")
    .filter(
      (token) => token.length > 0 && !SERVICE_SEARCH_STOP_WORDS.has(token),
    )
    .map(canonicalServiceToken);
}

export function analyzeServiceQuery(value: string): ServiceQueryAnalysis {
  const normalized = normalizeServiceSearchText(value);
  const rawMeaningfulTokens = normalized
    .split(" ")
    .filter(
      (token) => token.length > 0 && !SERVICE_SEARCH_STOP_WORDS.has(token),
    );
  let tokens: string[] | null = null;
  let preferActiveService = false;

  if (
    rawMeaningfulTokens.length === 1 &&
    /^(?:montador(?:es)?|montagem|montagen)$/.test(rawMeaningfulTokens[0])
  ) {
    tokens = ["montagem"];
    preferActiveService = true;
  } else if (
    rawMeaningfulTokens.length === 1 &&
    /^desentup(?:idor|ir)$/.test(rawMeaningfulTokens[0])
  ) {
    tokens = ["desentupimento"];
    preferActiveService = true;
  } else if (
    /\b(?:montar|montagem|montagen|montador(?:es)?)\b.*\b(?:guarda\s*roupa|armario|movel|moveis)\b/.test(
      normalized,
    )
  ) {
    tokens = ["montagem", "movel"];
    preferActiveService = true;
  } else if (/\bdesentup(?:ir|idor)?\b.*\bpia\b/.test(normalized)) {
    tokens = ["desentupimento", "pia"];
    preferActiveService = true;
  } else if (/\bpia\b.*\bentupid[ao]s?\b/.test(normalized)) {
    tokens = ["desentupimento", "pia"];
  } else if (
    /\btorneira\b.*\bvaz\w*\b|\bvaz\w*\b.*\btorneira\b/.test(normalized)
  ) {
    tokens = ["vazamento"];
  } else if (
    /\b(?:faxina|faxineir[ao]s?|limpar|limpeza)\b.*\b(?:casa|residencia|apartamento)\b/.test(
      normalized,
    )
  ) {
    tokens = ["faxina"];
  } else if (
    /\b(?:cortar|aparar|podar|cuidar)\b.*\b(?:grama|jardim)\b/.test(normalized)
  ) {
    tokens = ["jardim"];
  } else if (
    /\b(?:abrir|destrancar)\b.*\b(?:porta|fechadura)\b|\bchave\b.*\b(?:presa|quebrada)\b|\bperd\w*\b.*\bchave\b.*\btranc\w*\b/.test(
      normalized,
    )
  ) {
    tokens = ["abertura", "fechadura"];
  } else if (/\b(?:limpar|limpeza)\b.*\bvidraca\b/.test(normalized)) {
    tokens = ["vidro"];
  } else if (/\bfazer\b.*\bunhas?\b/.test(normalized)) {
    tokens = ["manicure"];
  } else if (/\borganizar\b.*\b(armario|cozinha|ambiente)\b/.test(normalized)) {
    const target = normalized.match(
      /\borganizar\b.*\b(armario|cozinha|ambiente)\b/,
    )?.[1];
    tokens = ["organizacao", target ?? "ambiente"];
  } else if (/\bventilador\b.*\bteto\b/.test(normalized)) {
    tokens = ["ventilador"];
  } else if (/\bmanutencao\b.*\b(?:jardim|gas)\b/.test(normalized)) {
    const target = normalized.includes("jardim") ? "jardim" : "gas";
    tokens = ["manutencao", target];
  } else if (/\blimpeza\b.*\bpos\b.*\b(?:obra|reforma)\b/.test(normalized)) {
    tokens = ["limpeza", "pos", "reforma"];
  } else if (/\breforma\b.*\bbanheiro\b/.test(normalized)) {
    tokens = ["reforma", "banheiro"];
  }

  const baseTokens = tokens ?? serviceSearchTokens(value);
  const specificTokens = baseTokens.filter(
    (token) => !GENERIC_SERVICE_ACTION_TOKENS.has(token),
  );
  const effectiveTokens =
    tokens ?? (specificTokens.length > 0 ? specificTokens : baseTokens);

  return {
    tokens: effectiveTokens,
    semanticQuery: effectiveTokens.join(" ") || normalized,
    preferActiveService,
  };
}

export function strongTokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;

  const similarity = stringSimilarity(left, right);
  return similarity >= 0.8 ? similarity : 0;
}


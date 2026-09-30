import { parsePortugueseDate, parseTimeFromText, parseTimePeriodFromText } from "../../utils/date.util";
import type { NluEntities, NluIntent } from "./types";
import { isSimpleAgendarVariant, isStandaloneDateInput, normalizeForRules } from "./rules";

export function extractDate(message: string, timeZone?: string): string | undefined {
  return parsePortugueseDate(message, { timeZone }) ?? undefined;
}

export function extractTime(message: string): string | undefined {
  // parseTimeFromText foi concebida para uma resposta curta do usuário. Em uma
  // frase inteira, priorizamos o trecho que contém a indicação de horário.
  const numeric = message.match(/\b\d{1,2}(?::\d{2}|h\d{1,2})\b/i);
  if (numeric) return parseTimeFromText(numeric[0]) ?? undefined;

  const afterTimeMarker = message.match(
    /(?:^|\s)(?:às|as|por volta de)\s+(.+)$/i,
  );
  if (afterTimeMarker)
    return parseTimeFromText(afterTimeMarker[1]) ?? undefined;
  return parseTimeFromText(message) ?? undefined;
}

export function extractServiceCandidate(message: string): string | undefined {
  const decodedMessage = message.replace(
    /(?:&nbsp;|&#0*32;|&#x0*20;|&#0*160;|&#x0*a0;)/gi,
    " ",
  );
  const patterns = [
    /^\s*((?:troca|trocar)\s+de\s+.+)$/i,
    /\b(?:agendar|marcar|contratar|reservar|chamar)\s+(?:(?:um|uma|o|a)\s+)?(.+)$/i,
    /\b(?:quero|preciso|gostaria|desejo)\s+(?:de\s+)?(?:(?:um|uma|o|a)\s+)?(.+)$/i,
  ];
  const raw = patterns
    .map((pattern) => decodedMessage.match(pattern)?.[1])
    .find(Boolean);
  if (!raw) return undefined;

  let candidate = raw
    .replace(/^(?:um|uma|o|a)\s+/i, "")
    .replace(
      /\s+(?:(?:para|no|na|em)\s+)?(?:hoje|hj|amanh[ãa]|amnh|depois\s+de\s+amanh[ãa]|dps\s+de\s+amanh[ãa]|pr[oó]x(?:ima)?\s+)?(?:segunda|seg|ter[cç]a|ter|quarta|qua|quinta|qui|sexta|sex|s[aá]bad+o+|sab|domingo|dom)(?:-?feira)?(?:\s+(?:que|q)\s+vem)?.*$/i,
      "",
    )
    .replace(
      /\s+(?:(?:para|no|na|em)\s+)?(?:dia\s+)?(?:\d{1,2}|primeiro|um|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)(?:\s+e\s+\w+)?(?:\s*(?:\/|\.|-)|\s+(?:de|do|da)\s+).+$/i,
      "",
    )
    .replace(/\s+(?:dia\s+\d{1,2}|hoje|hj|amanh[ãa]|amnh)(?:\s|$).*$/i, "")
    .replace(/(?:[àa]s?)\s+\d{1,2}(?::\d{2})?(?:\s*(?:h|horas))?.*$/i, "")
    .replace(/\s+(?:de|da|pela|na)\s+(?:manh[ãa]|tarde|noite).*$/i, "")
    .replace(
      /\s+(?:por\s+favor|porfavor|pfv|por\s+gentileza|gentileza|obrigad[oa])$/i,
      "",
    )
    .trim()
    .replace(/[,.!?]+$/, "");

  candidate = candidate.replace(/^trocar\s+de\s+/i, "troca de ");

  // Quando a pessoa escreve "quero agenda limpeza" ou erra "agendar", a
  // primeira palavra representa a ação, não o nome do serviço.
  const candidateWords = candidate.split(/\s+/).filter(Boolean);
  const firstWord = normalizeForRules(candidateWords[0] ?? "");
  if (isSimpleAgendarVariant(firstWord)) {
    candidateWords.shift();
    if (/^(?:um|uma|o|a)$/.test(normalizeForRules(candidateWords[0] ?? ""))) {
      candidateWords.shift();
    }
    candidate = candidateWords.join(" ").trim();
  } else if (
    /^(?:novo|nova)$/.test(firstWord) &&
    isSimpleAgendarVariant(normalizeForRules(candidateWords[1] ?? ""))
  ) {
    candidate = candidateWords.slice(2).join(" ").trim();
  } else if (/^(?:fazer|iniciar)$/.test(firstWord)) {
    let actionIndex = 1;
    if (
      /^(?:um|uma|o|a)$/.test(
        normalizeForRules(candidateWords[actionIndex] ?? ""),
      )
    ) {
      actionIndex += 1;
    }
    if (
      /^(?:novo|nova)$/.test(
        normalizeForRules(candidateWords[actionIndex] ?? ""),
      )
    ) {
      actionIndex += 1;
    }
    if (
      normalizeForRules(candidateWords[actionIndex] ?? "") === "agendamento"
    ) {
      actionIndex += 1;
      if (
        /^(?:de|para)$/.test(
          normalizeForRules(candidateWords[actionIndex] ?? ""),
        )
      ) {
        actionIndex += 1;
      }
      candidate = candidateWords.slice(actionIndex).join(" ").trim();
    }
  }

  candidate = candidate
    .replace(/^(?:de|para|pra|pro|em|no|na|um|uma|o|a)\s+/i, "")
    .replace(/\s+(?:de|para|pra|pro|em|no|na|um|uma|o|a)$/i, "")
    .replace(/\s+(?:na(?:\s+minha)?|minha|em\s+minha)\s+agenda.*$/i, "")
    .replace(/\s+(?:de|para)$/i, "")
    .replace(/^(?:de|para)$/i, "")
    .trim();

  const genericTerms = new Set([
    "",
    "a",
    "o",
    "as",
    "os",
    "um",
    "uma",
    "uns",
    "umas",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "para",
    "pra",
    "pro",
    "pras",
    "pros",
    "dia",
    "dias",
    "semana",
    "semanas",
    "proxima",
    "proximo",
    "proximas",
    "proximos",
    "prox",
    "servico",
    "serviço",
    "um serviço",
    "uma ajuda",
    "ajuda",
    "agendamento",
    "agenda",
    "ageda",
    "agedar",
    "meu agendamento",
    "minha agenda",
    "novo agendamento",
    "nova agenda",
    "horario",
    "horário",
    "agendar",
    "marcar",
    "reservar",
    "contratar",
    "chamar",
  ]);
  // Depois de remover "quero/agendar", o candidato pode ser somente a data.
  // A regra ancorada preserva nomes como "segunda via" e "segunda opinião".
  if (
    genericTerms.has(normalizeForRules(candidate)) ||
    isStandaloneDateInput(candidate)
  ) return undefined;
  if (
    parsePortugueseDate(candidate) ||
    parsePortugueseDate(message) ||
    parseTimePeriodFromText(candidate) ||
    parseTimeFromText(candidate)
  ) {
    // Se a mensagem contém uma data legível e a palavra restante é um artigo ou palavra genérica
    const words = candidate.split(/\s+/).filter(w => !genericTerms.has(normalizeForRules(w)));
    if (words.length === 0) return undefined;
  }
  return candidate.slice(0, 200);
}

export function extractEntities(
  message: string,
  intent: NluIntent,
  timeZone?: string,
): NluEntities {
  const entities: NluEntities = {};
  const trimmed = message.trim();

  if (intent === "AGENDAR" || intent === "ALTERAR") {
    const date = extractDate(trimmed, timeZone);
    if (date) entities.date = date;
    const time = extractTime(trimmed);
    if (time) entities.time = time;
    const timePeriod = parseTimePeriodFromText(trimmed);
    if (timePeriod) entities.time_period = timePeriod;
  }

  if (intent === "AGENDAR") {
    const service = extractServiceCandidate(trimmed);
    if (service) entities.service = service;
  }

  if (intent === "ALTERAR" || intent === "CANCELAR") {
    const idMatch = trimmed.match(
      /\b(?:id|agendamento|n[uú]mero)?\s*#?\s*(\d+)\b/i,
    );
    if (idMatch) {
      const appointmentId = Number(idMatch[1]);
      if (Number.isInteger(appointmentId) && appointmentId > 0) {
        entities.appointment_id = appointmentId;
      }
    }
  }

  return entities;
}

/**
 * Entradas estruturadas são tratadas por regras porque pertencem aos estados do
 * fluxo, não ao problema de classificação de intenção. Mensagens abertas sempre
 * seguem para TF-IDF + SVM.
 */

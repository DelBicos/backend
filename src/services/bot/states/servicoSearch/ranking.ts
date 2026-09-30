import { normalizeText, stringSimilarity } from "../../../../utils/nlp.util";
import { BotServiceChoice } from "../../../../models/BotChatSession";
import { normalizeServiceChoiceTitleKey } from "../../serviceChoice.helpers";
import type { BotCatalogService, LexicalMatch, RankedService } from "./types";
import { analyzeServiceQuery, serviceSearchTokens, strongTokenSimilarity, normalizeServiceSearchText, canonicalServiceToken } from "./text";

export function calculateLexicalMatch(
  searchTokens: string[],
  candidateValues: Array<string | null | undefined>,
): LexicalMatch | null {
  if (searchTokens.length === 0) return null;

  const candidateTokens = Array.from(
    new Set(
      candidateValues.flatMap((value) =>
        typeof value === "string" ? serviceSearchTokens(value) : [],
      ),
    ),
  );
  if (candidateTokens.length === 0) return null;

  const tokenScores = searchTokens.map((searchToken) =>
    candidateTokens.reduce(
      (best, candidateToken) =>
        Math.max(best, strongTokenSimilarity(searchToken, candidateToken)),
      0,
    ),
  );
  const matchedScores = tokenScores.filter((score) => score > 0);
  if (matchedScores.length === 0) return null;

  const coverage = matchedScores.length / searchTokens.length;
  if (coverage < 0.5) return null;

  return {
    coverage,
    score:
      matchedScores.reduce((total, score) => total + score, 0) /
      matchedScores.length,
  };
}

export function findLexicalServiceAnchors(
  searchTokens: string[],
  services: BotCatalogService[],
): RankedService[] {
  const ranked = services
    .map((svc): RankedService | null => {
      const match = calculateLexicalMatch(searchTokens, [
        svc.title,
        svc.Subcategory?.title,
        svc.Subcategory?.Category?.title,
      ]);
      return match ? { svc, ...match } : null;
    })
    .filter((item): item is RankedService => item !== null)
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.score - left.score ||
        left.svc.id - right.svc.id,
    );

  const best = ranked[0];
  if (!best) return [];

  // Uma palavra compartilhada não deve arrastar opções mais fracas quando
  // existe uma correspondência claramente mais completa para a consulta.
  return ranked.filter(
    (item) =>
      item.coverage === best.coverage && item.score >= best.score - 0.08,
  );
}

export function findLexicalServiceTitleAnchors(
  searchTokens: string[],
  services: BotCatalogService[],
): RankedService[] {
  return services
    .map((svc): RankedService | null => {
      const match = calculateLexicalMatch(searchTokens, [svc.title]);
      return match ? { svc, ...match } : null;
    })
    .filter((item): item is RankedService => item !== null)
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.score - left.score ||
        left.svc.id - right.svc.id,
    );
}

export function serviceTitlesCoverQuery(
  searchTokens: string[],
  titleMatches: RankedService[],
): boolean {
  return (
    searchTokens.length > 0 &&
    searchTokens.every((token) =>
      titleMatches.some(
        ({ svc }) =>
          calculateLexicalMatch([token], [svc.title])?.coverage === 1,
      ),
    )
  );
}

export function findServiceChoiceByName(
  userInput: string,
  choices: BotServiceChoice[],
): BotServiceChoice | null {
  const normalizedInput = normalizeText(userInput);
  const exact = choices.find(
    (choice) =>
      normalizeText(choice.title) === normalizedInput ||
      (choice.subcategoryName &&
        normalizeText(choice.subcategoryName) === normalizedInput) ||
      (choice.categoryName &&
        normalizeText(choice.categoryName) === normalizedInput),
  );
  if (exact) return exact;

  const searchTokens = analyzeServiceQuery(userInput).tokens;
  if (searchTokens.length === 0) return null;

  const matches = choices.filter((choice) => {
    const match = calculateLexicalMatch(searchTokens, [
      choice.title,
      choice.subcategoryName,
      choice.categoryName,
    ]);
    return match?.coverage === 1;
  });

  // Termos parciais só selecionam quando identificam uma opção de forma
  // inequívoca. Caso contrário, o texto passa a ser uma nova busca.
  return matches.length === 1 ? matches[0] : null;
}


export function filterStrongSemanticServices(
  hits: Array<{ svc: BotCatalogService; score: number }>,
  allServices: BotCatalogService[],
): Array<{ svc: BotCatalogService; score: number }> {
  const groups = new Map<string, { key: string; score: number }>();

  for (const hit of hits) {
    const key = semanticServiceGroupKey(hit.svc);
    const current = groups.get(key);
    if (current) {
      current.score = Math.max(current.score, hit.score);
    } else {
      groups.set(key, { key, score: hit.score });
    }
  }

  const rankedGroups = Array.from(groups.values()).sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const best = rankedGroups[0];
  if (!best || best.score < 0.6) return [];

  const second = rankedGroups[1];
  if (second && best.score - second.score < 0.1) return [];

  const acceptedKeys = new Set(
    rankedGroups
      .filter((group) => group.score >= 0.6 && best.score - group.score <= 0.2)
      .map((group) => group.key),
  );
  const groupScore = new Map(
    rankedGroups.map((group) => [group.key, group.score]),
  );

  return allServices
    .filter((service) => acceptedKeys.has(semanticServiceGroupKey(service)))
    .map((svc) => ({
      svc,
      score: groupScore.get(semanticServiceGroupKey(svc)) ?? 0,
    }))
    .sort(
      (left, right) => right.score - left.score || left.svc.id - right.svc.id,
    );
}

export function semanticServiceGroupKey(service: BotCatalogService): string {
  const subcategoryId =
    service.subcategory_id ?? service.Subcategory?.id ?? "sem-subcategoria";
  return `${normalizeServiceChoiceTitleKey(service.title)}|${subcategoryId}`;
}


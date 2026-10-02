export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function stringSimilarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

export function calculateMatchScore(svc: any, normalizedSearch: string, searchKeywords: string[]): number {
  const svcTitleNorm = normalizeText(svc.title);
  const subcatTitleNorm = svc.Subcategory ? normalizeText(svc.Subcategory.title) : "";
  const catTitleNorm = svc.Subcategory && svc.Subcategory.Category ? normalizeText(svc.Subcategory.Category.title) : "";

  if (svcTitleNorm === normalizedSearch) return 10;
  if (svcTitleNorm.includes(normalizedSearch)) return 8;

  if (subcatTitleNorm === normalizedSearch) return 7;
  if (catTitleNorm === normalizedSearch) return 6;
  if (subcatTitleNorm.includes(normalizedSearch)) return 5;
  if (catTitleNorm.includes(normalizedSearch)) return 4;

  const combinedText = `${svcTitleNorm} ${subcatTitleNorm} ${catTitleNorm}`;
  const allKeywordsMatch = searchKeywords.length > 0 && searchKeywords.every(kw => combinedText.includes(kw));
  if (allKeywordsMatch) return 3;

  const svcSim = stringSimilarity(normalizedSearch, svcTitleNorm);
  const subcatSim = subcatTitleNorm ? stringSimilarity(normalizedSearch, subcatTitleNorm) : 0;
  const maxSim = Math.max(svcSim, subcatSim);

  if (maxSim >= 0.65) return maxSim * 2;
  return 0;
}

export function findBestOptionMatch<T extends { title: string }>(userInput: string, options: T[]): T | null {
  const normInput = normalizeText(userInput);
  const inputKeywords = normInput.split(" ").filter(w => w.length > 0);

  let bestMatch: T | null = null;
  let bestScore = 0;

  for (const opt of options) {
    const normOpt = normalizeText(opt.title);
    const optKeywords = normOpt.split(" ").filter(w => w.length > 0);

    let score = 0;

    // 1. Exact match
    if (normOpt === normInput) {
      score = 100;
    }
    // 2. Substring match
    else if (normOpt.includes(normInput) || normInput.includes(normOpt)) {
      score = 80;
    }
    // 3. Keyword match with prefix compatibility (e.g., "geral" vs "gerais")
    else {
      let matchedKws = 0;
      for (const inKw of inputKeywords) {
        for (const optKw of optKeywords) {
          // Exact kw match
          if (inKw === optKw) {
            matchedKws++;
            break;
          }
          // Prefix match (at least 4 chars)
          if (inKw.length >= 4 && optKw.length >= 4) {
            const minLen = Math.min(inKw.length, optKw.length);
            const prefixLen = Math.max(4, Math.floor(minLen * 0.8));
            if (inKw.slice(0, prefixLen) === optKw.slice(0, prefixLen)) {
              matchedKws++;
              break;
            }
          }
        }
      }
      score = (matchedKws / inputKeywords.length) * 50;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = opt;
    }
  }

  // Threshold for matching
  if (bestScore >= 25) {
    return bestMatch;
  }
  return null;
}

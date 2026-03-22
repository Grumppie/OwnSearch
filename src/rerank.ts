import type { SearchHit } from "./qdrant.js";

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalize(input).split(" ").filter((token) => token.length > 1);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function lexicalOverlap(queryTokens: string[], haystack: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystackTokens = new Set(tokenize(haystack));
  let matches = 0;
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.length;
}

function nearDuplicate(a: SearchHit, b: SearchHit): boolean {
  const aTokens = unique(tokenize(a.content)).slice(0, 48);
  const bTokens = unique(tokenize(b.content)).slice(0, 48);
  if (aTokens.length === 0 || bTokens.length === 0) {
    return false;
  }

  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aTokens) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 && intersection / union >= 0.8;
}

function contentSignature(content: string): string {
  return tokenize(content).slice(0, 24).join(" ");
}

interface RankedHit extends SearchHit {
  rerankScore: number;
}

export function rerankAndDeduplicate(query: string, hits: SearchHit[], limit: number): SearchHit[] {
  const normalizedQuery = normalize(query);
  const queryTokens = unique(tokenize(query));

  const ranked = hits
    .map((hit) => {
      const overlap = lexicalOverlap(queryTokens, hit.content);
      const pathOverlap = lexicalOverlap(queryTokens, `${hit.relativePath} ${hit.rootName}`);
      const exactPhrase = normalizedQuery.length > 0 && normalize(hit.content).includes(normalizedQuery) ? 0.2 : 0;
      const score = hit.score + overlap * 0.22 + pathOverlap * 0.08 + exactPhrase;
      return { ...hit, rerankScore: score } satisfies RankedHit;
    })
    .sort((left, right) => right.rerankScore - left.rerankScore);

  const selected: RankedHit[] = [];
  const signatureSet = new Set<string>();
  const perFileCounts = new Map<string, number>();
  const preferredPerFileLimit = 2;

  function canTake(hit: RankedHit, enforcePerFileLimit: boolean): boolean {
    const signature = contentSignature(hit.content);
    if (signature && signatureSet.has(signature)) {
      return false;
    }

    if (selected.some((existing) => nearDuplicate(existing, hit))) {
      return false;
    }

    if (enforcePerFileLimit) {
      const current = perFileCounts.get(hit.relativePath) ?? 0;
      if (current >= preferredPerFileLimit) {
        return false;
      }
    }

    return true;
  }

  function add(hit: RankedHit): void {
    selected.push(hit);
    const signature = contentSignature(hit.content);
    if (signature) {
      signatureSet.add(signature);
    }
    perFileCounts.set(hit.relativePath, (perFileCounts.get(hit.relativePath) ?? 0) + 1);
  }

  for (const hit of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (canTake(hit, true)) {
      add(hit);
    }
  }

  if (selected.length < limit) {
    for (const hit of ranked) {
      if (selected.length >= limit) {
        break;
      }

      if (selected.some((existing) => existing.id === hit.id)) {
        continue;
      }

      if (canTake(hit, false)) {
        add(hit);
      }
    }
  }

  return selected.map(({ rerankScore: _rerankScore, ...hit }) => hit);
}

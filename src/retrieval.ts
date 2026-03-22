import { buildContextBundle } from "./context.js";
import { embedQuery } from "./gemini.js";
import type { SearchHit } from "./qdrant.js";
import { createStore } from "./qdrant.js";

const LEADING_PATTERNS = [
  /^(what is|what was|who is|who was)\s+/i,
  /^(tell me about|explain|summarize|describe)\s+/i,
  /^(where is|where was|where does|where did)\s+/i,
  /^(how does|how do|how did|why does|why did)\s+/i
];

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why"
]);

export interface DeepSearchOptions {
  rootIds?: string[];
  pathSubstring?: string;
  perQueryLimit?: number;
  finalLimit?: number;
  maxChars?: number;
}

export function deriveQueryVariants(query: string): string[] {
  const normalized = query.trim().replace(/\s+/g, " ");
  const variants = new Set<string>();

  if (!normalized) {
    return [];
  }

  variants.add(normalized);

  let stripped = normalized;
  for (const pattern of LEADING_PATTERNS) {
    stripped = stripped.replace(pattern, "");
  }
  stripped = stripped.replace(/[?.!]+$/g, "").trim();
  if (stripped && stripped !== normalized) {
    variants.add(stripped);
  }

  const quotedMatches = [...normalized.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
  for (const match of quotedMatches) {
    variants.add(match);
  }

  const keywordVariant = normalized
    .split(/[^A-Za-z0-9_-]+/)
    .filter((token) => token && !STOPWORDS.has(token.toLowerCase()))
    .slice(0, 8)
    .join(" ")
    .trim();

  if (keywordVariant && keywordVariant !== normalized && keywordVariant !== stripped) {
    variants.add(keywordVariant);
  }

  return [...variants].slice(0, 4);
}

function diversifyHits(hits: SearchHit[], limit: number): SearchHit[] {
  const seenIds = new Set<string>();
  const fileCounts = new Map<string, number>();
  const diversified: SearchHit[] = [];

  const sorted = [...hits].sort((a, b) => {
    const aCount = fileCounts.get(a.relativePath) ?? 0;
    const bCount = fileCounts.get(b.relativePath) ?? 0;
    const aScore = a.score - aCount * 0.015;
    const bScore = b.score - bCount * 0.015;
    return bScore - aScore;
  });

  for (const hit of sorted) {
    if (seenIds.has(hit.id)) {
      continue;
    }

    const count = fileCounts.get(hit.relativePath) ?? 0;
    if (count >= 3 && diversified.length >= Math.max(3, Math.floor(limit / 2))) {
      continue;
    }

    diversified.push(hit);
    seenIds.add(hit.id);
    fileCounts.set(hit.relativePath, count + 1);

    if (diversified.length >= limit) {
      break;
    }
  }

  return diversified;
}

export async function deepSearchContext(query: string, options: DeepSearchOptions = {}) {
  const store = await createStore();
  const variants = deriveQueryVariants(query);
  const allHits: SearchHit[] = [];

  for (const variant of variants) {
    const vector = await embedQuery(variant);
    const hits = await store.search(
      vector,
      {
        queryText: variant,
        rootIds: options.rootIds,
        pathSubstring: options.pathSubstring
      },
      Math.max(1, Math.min(options.perQueryLimit ?? 6, 12))
    );
    allHits.push(...hits);
  }

  const finalHits = diversifyHits(allHits, Math.max(1, Math.min(options.finalLimit ?? 10, 20)));
  const bundle = buildContextBundle(query, finalHits, Math.max(500, options.maxChars ?? 16000));

  return {
    query,
    queryVariants: variants,
    hitCount: finalHits.length,
    distinctFiles: [...new Set(finalHits.map((hit) => hit.relativePath))].length,
    bundle
  };
}

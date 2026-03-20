import type { SearchHit } from "./qdrant.js";
import type { ContextBundle, ContextBundleItem } from "./types.js";

export function buildContextBundle(
  query: string,
  hits: SearchHit[],
  maxChars = 12000
): ContextBundle {
  const results: ContextBundleItem[] = [];
  let totalChars = 0;

  for (const hit of hits) {
    if (results.length > 0 && totalChars + hit.content.length > maxChars) {
      break;
    }

    results.push({
      id: hit.id,
      score: hit.score,
      rootId: hit.rootId,
      rootName: hit.rootName,
      relativePath: hit.relativePath,
      chunkIndex: hit.chunkIndex,
      content: hit.content
    });
    totalChars += hit.content.length;
  }

  return {
    query,
    totalChars,
    results
  };
}

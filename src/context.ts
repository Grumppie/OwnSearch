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
    const last = results.at(-1);
    if (
      last &&
      last.rootId === hit.rootId &&
      last.relativePath === hit.relativePath &&
      hit.chunkIndex === last.chunkIndex + 1
    ) {
      const mergedContent = `${last.content}\n${hit.content}`.trim();
      const mergedDelta = mergedContent.length - last.content.length;
      if (totalChars + mergedDelta <= maxChars) {
        last.content = mergedContent;
        last.chunkIndex = hit.chunkIndex;
        totalChars += mergedDelta;
        continue;
      }
    }

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

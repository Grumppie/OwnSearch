export function chunkText(content: string, chunkSize: number, chunkOverlap: number): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const minimumBoundary = start + Math.floor(chunkSize * 0.5);
      const newlineBoundary = normalized.lastIndexOf("\n", end);
      const whitespaceBoundary = normalized.lastIndexOf(" ", end);
      const punctuationBoundary = Math.max(
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("? ", end),
        normalized.lastIndexOf("! ", end)
      );
      const boundary = Math.max(newlineBoundary, whitespaceBoundary, punctuationBoundary);
      if (boundary > minimumBoundary) {
        end = boundary;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - chunkOverlap, start + 1);
  }

  return chunks;
}

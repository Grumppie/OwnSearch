import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph } from "docx";
import { deleteRootDefinition, loadOwnSearchEnv } from "../src/config.js";
import { DEFAULT_MAX_FILE_BYTES } from "../src/constants.js";
import { collectTextFiles } from "../src/files.js";
import { embedQuery } from "../src/gemini.js";
import { indexPath } from "../src/indexer.js";
import { createStore } from "../src/qdrant.js";

loadOwnSearchEnv();

const workspaceDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const smokeRoot = path.join(workspaceDir, "smoke-mixed-text-docs");
const largeRoot = path.join(workspaceDir, "smoke-large-text");

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function writeDocx(filePath: string, text: string): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [new Paragraph(text)]
      }
    ]
  });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, buffer);
}

async function writeLargeText(filePath: string, targetBytes: number): Promise<void> {
  const handle = await fs.open(filePath, "w");
  const line = "Large text smoke test line for OwnSearch plain text ingestion.\n";
  let written = 0;

  try {
    while (written < targetBytes) {
      const chunk = line.repeat(8192);
      const result = await handle.write(chunk);
      written += result.bytesWritten;
    }
  } finally {
    await handle.close();
  }
}

async function setupCorpus(): Promise<void> {
  await fs.rm(smokeRoot, { recursive: true, force: true });
  await fs.rm(largeRoot, { recursive: true, force: true });
  await fs.mkdir(smokeRoot, { recursive: true });
  await fs.mkdir(largeRoot, { recursive: true });

  await fs.writeFile(
    path.join(smokeRoot, "notes.txt"),
    "OwnSearch text smoke test. The secret phrase is amber lantern and should be retrieved from notes.txt.\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(smokeRoot, "memo.rtf"),
    "{\\rtf1\\ansi OwnSearch RTF smoke test. The reference phrase is cobalt orchard and should be retrieved from memo.rtf.}",
    "utf8"
  );

  await writeDocx(
    path.join(smokeRoot, "report.docx"),
    "OwnSearch DOCX smoke test. The verification phrase is crimson harbor and should be retrieved from report.docx."
  );

  await fs.copyFile(
    path.join(workspaceDir, "_testing", "dnd_test", "D&D 5e - DM's Basic Rules v 0.3.pdf"),
    path.join(smokeRoot, "rules.pdf")
  );

  await writeLargeText(path.join(largeRoot, "huge.log"), DEFAULT_MAX_FILE_BYTES + 2 * 1024 * 1024);
}

async function verifyCollectorCoverage(): Promise<{ pdfQuery: string }> {
  const collected = await collectTextFiles(smokeRoot, DEFAULT_MAX_FILE_BYTES);
  const collectedNames = new Set(collected.map((file) => file.relativePath));
  assert(collectedNames.has("notes.txt"), "notes.txt was not collected");
  assert(collectedNames.has("memo.rtf"), "memo.rtf was not collected");
  assert(collectedNames.has("report.docx"), "report.docx was not collected");
  assert(collectedNames.has("rules.pdf"), "rules.pdf was not collected");

  const pdf = collected.find((file) => file.relativePath === "rules.pdf");
  assert(pdf && pdf.content.length > 0, "rules.pdf content was not extracted");

  const advantageIndex = pdf.content.toLowerCase().indexOf("advantage");
  assert(advantageIndex >= 0, "rules.pdf extracted text did not contain an advantage phrase");
  const pdfQuery = pdf.content.slice(advantageIndex, Math.min(advantageIndex + 90, pdf.content.length)).replace(/\s+/g, " ").trim();
  assert(pdfQuery.length > 20, "Derived PDF query was too short");

  const largeCollected = await collectTextFiles(largeRoot, DEFAULT_MAX_FILE_BYTES);
  assert(
    largeCollected.some((file) => file.relativePath === "huge.log"),
    "Large plain text file was skipped by collector"
  );

  return { pdfQuery };
}

async function verifyRetrieval(pdfQuery: string): Promise<Record<string, unknown>> {
  const indexResult = await indexPath(smokeRoot, { name: "smoke-mixed-text-docs" });
  const store = await createStore();

  async function topHitFor(query: string): Promise<string | undefined> {
    const vector = await embedQuery(query);
    const hits = await store.search(vector, { rootIds: [indexResult.root.id] }, 5);
    return hits[0]?.relativePath;
  }

  const noteTopHit = await topHitFor("amber lantern");
  const rtfTopHit = await topHitFor("cobalt orchard");
  const docxTopHit = await topHitFor("crimson harbor");
  const pdfVector = await embedQuery(pdfQuery);
  const pdfHits = await store.search(pdfVector, { rootIds: [indexResult.root.id] }, 5);

  assert(noteTopHit === "notes.txt", `Expected notes.txt top hit, got ${noteTopHit ?? "none"}`);
  assert(rtfTopHit === "memo.rtf", `Expected memo.rtf top hit, got ${rtfTopHit ?? "none"}`);
  assert(docxTopHit === "report.docx", `Expected report.docx top hit, got ${docxTopHit ?? "none"}`);
  assert(pdfHits.some((hit) => hit.relativePath === "rules.pdf"), "rules.pdf was not returned in top-5 PDF retrieval results");

  await store.deleteRoot(indexResult.root.id);
  await deleteRootDefinition(indexResult.root.id);

  return {
    indexedFiles: indexResult.indexedFiles,
    indexedChunks: indexResult.indexedChunks,
    noteTopHit,
    rtfTopHit,
    docxTopHit,
    pdfTopFivePaths: pdfHits.map((hit) => hit.relativePath)
  };
}

async function main(): Promise<void> {
  await setupCorpus();
  const { pdfQuery } = await verifyCollectorCoverage();
  const retrieval = await verifyRetrieval(pdfQuery);

  console.log(JSON.stringify({
    verdict: "pass",
    checkedFormats: [".txt", ".rtf", ".docx", ".pdf"],
    largePlainTextBypassVerified: true,
    retrieval
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

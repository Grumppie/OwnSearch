import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { loadOwnSearchEnv } from "../src/config.js";
import { buildContextBundle } from "../src/context.js";
import { embedQuery } from "../src/gemini.js";
import { createStore } from "../src/qdrant.js";
import { deepSearchContext } from "../src/retrieval.js";

const execFile = promisify(execFileCallback);

loadOwnSearchEnv();

const ROOT_ID = "testing-c-users-dell-desktop-projects-ownsearch-testing";
const CORPUS_DIR = path.resolve("_testing", "mireglass_test");
const NOISE_FILES = new Set([
  "mireglass_test/09_benchmark_queries.txt",
  "mireglass_test/10_extra_hard_notes_for_chunking.txt"
]);

type MethodName = "grep" | "shallow" | "deep";

interface ProbeCase {
  id: string;
  category: "literal" | "paraphrase" | "alias" | "contradiction" | "noise" | "synthesis";
  query: string;
  mustFiles: string[];
  shouldMarkers?: string[];
  contradictionMarkers?: string[];
  disallowedMarkers?: string[];
  notes: string;
}

interface RetrievalResult {
  method: MethodName;
  elapsedMs: number;
  paths: string[];
  text: string;
}

interface CaseReport {
  id: string;
  category: string;
  query: string;
  notes: string;
  results: Array<{
    method: MethodName;
    elapsedMs: number;
    mustFileRecall: number;
    mustFilesFound: string[];
    shouldMarkersFound: string[];
    contradictionCoverage: number;
    disallowedMarkersFound: string[];
    noiseFiles: string[];
    distinctFiles: number;
    gapFlags: string[];
  }>;
}

const CASES: ProbeCase[] = [
  {
    id: "literal-oathfen",
    category: "literal",
    query: "What happened to Oathfen after the Sable Flood?",
    mustFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt"
    ],
    shouldMarkers: ["abandoned", "Oathfen Crossing", "mud and memory"],
    contradictionMarkers: ["abandoned", "crossing persists"],
    notes: "Baseline literal query. All methods should do reasonably well."
  },
  {
    id: "paraphrase-oathfen",
    category: "paraphrase",
    query: "What became of the marsh settlement that later survived mostly as a customs crossing after the black-water disaster?",
    mustFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    shouldMarkers: ["Oathfen Crossing", "mud and memory", "crossing rather than town"],
    notes: "Exposes lexical dependence. Grep should struggle if it relies on exact entity tokens."
  },
  {
    id: "alias-lantern",
    category: "alias",
    query: "Was the saint's flood lamp genuinely relocated, or is that just reliquary confusion?",
    mustFiles: [
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    shouldMarkers: ["sealed crate", "uncertain", "not the Lantern"],
    disallowedMarkers: ["marsh processional lamp, anonymous"],
    notes: "Tests alias resolution and false-friend handling around the Lantern of Saint Tol."
  },
  {
    id: "contradiction-tower",
    category: "contradiction",
    query: "Did officials really chain bodies to the tower, or was that denied later?",
    mustFiles: [
      "mireglass_test/06_interrogation_of_ferryman_joss_orrel.txt",
      "mireglass_test/03_concord_ledger_extracts.txt"
    ],
    contradictionMarkers: ["There were wrists in them", "No bodies were discovered"],
    shouldMarkers: ["unreliable drunk", "panic claims"],
    notes: "Tests contradiction preservation instead of one-sided retrieval."
  },
  {
    id: "noise-bell",
    category: "noise",
    query: "Is the Glass Bell of Nacre Ford a real object or just panic folklore?",
    mustFiles: [
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    shouldMarkers: ["Likely apocryphal", "sound phenomenon", "peasant mysticism"],
    disallowedMarkers: ["bell moss", "The bell rang"],
    notes: "Tests whether retrieval gets distracted by semantically similar but irrelevant bell mentions."
  },
  {
    id: "synthesis-measured",
    category: "synthesis",
    query: "Why is 'measured falsely' politically dangerous rather than just religious language?",
    mustFiles: [
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    shouldMarkers: ["arithmetic", "survey baselines", "land-rights quarrel"],
    notes: "Requires cross-document synthesis, not just literal matching."
  },
  {
    id: "literal-smugglers",
    category: "literal",
    query: "What route would smugglers likely use to avoid Merovin toll control?",
    mustFiles: [
      "mireglass_test/02_field_guide_to_the_mireglass_marches.txt"
    ],
    shouldMarkers: ["Hollow Delta", "Saint Tol Ladder", "used by smugglers"],
    notes: "Single-document operational query. Grep should be strong."
  },
  {
    id: "paraphrase-smugglers",
    category: "paraphrase",
    query: "Which slower backwater path bypasses the chartered north-south toll route when inspections are lax?",
    mustFiles: [
      "mireglass_test/02_field_guide_to_the_mireglass_marches.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    shouldMarkers: ["Hollow Delta", "Saint Tol Ladder", "Merovin charter"],
    notes: "Exposes semantic retrieval value on operational questions without exact route names."
  }
];

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "did", "do", "does", "for", "from", "how", "i", "in", "is",
  "it", "just", "later", "of", "or", "rather", "really", "that", "the", "to", "was", "what", "which", "who", "why"
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCorpusPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "mireglass_test/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : normalized;
}

function deriveGrepPattern(query: string): string {
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
  const words = query
    .replace(/["?]/g, " ")
    .split(/[^A-Za-z0-9_-]+/)
    .filter((word) => word && !STOPWORDS.has(word.toLowerCase()))
    .slice(0, 8);

  const parts = [...quoted, ...words].map(escapeRegex);
  return parts.join("|");
}

async function runGrep(query: string): Promise<RetrievalResult> {
  const start = performance.now();
  const { stdout } = await execFile("rg", ["-n", "-i", deriveGrepPattern(query), CORPUS_DIR], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });
  const elapsedMs = performance.now() - start;

  const grouped = new Map<string, string[]>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^(.*?):\d+:(.*)$/);
    if (!match) {
      continue;
    }
    const filePath = normalizeCorpusPath(match[1]);
    const content = match[2].trim();
    const list = grouped.get(filePath) ?? [];
    list.push(content);
    grouped.set(filePath, list);
  }

  const paths = [...grouped.keys()];
  const text = paths
    .map((filePath) => `${filePath}\n${(grouped.get(filePath) ?? []).slice(0, 4).join("\n")}`)
    .join("\n");

  return { method: "grep", elapsedMs, paths, text };
}

async function runShallow(query: string): Promise<RetrievalResult> {
  const store = await createStore();
  const start = performance.now();
  const vector = await embedQuery(query);
  const hits = await store.search(vector, { queryText: query, rootIds: [ROOT_ID] }, 8);
  const bundle = buildContextBundle(query, hits, 12000);
  const elapsedMs = performance.now() - start;
  const paths = bundle.results.map((item) => item.relativePath);
  const text = bundle.results.map((item) => `${item.relativePath}\n${item.content}`).join("\n");
  return { method: "shallow", elapsedMs, paths, text };
}

async function runDeep(query: string): Promise<RetrievalResult> {
  const start = performance.now();
  const result = await deepSearchContext(query, {
    rootIds: [ROOT_ID],
    perQueryLimit: 6,
    finalLimit: 10,
    maxChars: 16000
  });
  const elapsedMs = performance.now() - start;
  const paths = result.bundle.results.map((item) => item.relativePath);
  const text = result.bundle.results.map((item) => `${item.relativePath}\n${item.content}`).join("\n");
  return { method: "deep", elapsedMs, paths, text };
}

function analyzeCase(testCase: ProbeCase, result: RetrievalResult) {
  const distinctPaths = [...new Set(result.paths)];
  const lowered = result.text.toLowerCase();
  const mustFilesFound = testCase.mustFiles.filter((filePath) => distinctPaths.includes(filePath));
  const shouldMarkersFound = (testCase.shouldMarkers ?? []).filter((marker) => lowered.includes(marker.toLowerCase()));
  const contradictionCoverage = (testCase.contradictionMarkers ?? []).filter((marker) => lowered.includes(marker.toLowerCase())).length;
  const disallowedMarkersFound = (testCase.disallowedMarkers ?? []).filter((marker) => lowered.includes(marker.toLowerCase()));
  const noiseFiles = distinctPaths.filter((filePath) => NOISE_FILES.has(filePath));
  const gapFlags: string[] = [];

  if (mustFilesFound.length < testCase.mustFiles.length) {
    gapFlags.push("missed_required_sources");
  }
  if ((testCase.shouldMarkers?.length ?? 0) > 0 && shouldMarkersFound.length === 0) {
    gapFlags.push("missed_key_evidence");
  }
  if ((testCase.contradictionMarkers?.length ?? 0) > 1 && contradictionCoverage < testCase.contradictionMarkers!.length) {
    gapFlags.push("failed_to_preserve_contradiction");
  }
  if (disallowedMarkersFound.length > 0) {
    gapFlags.push("likely_false_friend_or_noise");
  }
  if (noiseFiles.length > 0) {
    gapFlags.push("noise_file_leakage");
  }
  if (distinctPaths.length <= 1 && testCase.category === "synthesis") {
    gapFlags.push("insufficient_source_diversity");
  }

  return {
    method: result.method,
    elapsedMs: Math.round(result.elapsedMs),
    mustFileRecall: Number((mustFilesFound.length / testCase.mustFiles.length).toFixed(2)),
    mustFilesFound,
    shouldMarkersFound,
    contradictionCoverage: Number(
      ((testCase.contradictionMarkers?.length ?? 0) === 0
        ? 1
        : contradictionCoverage / testCase.contradictionMarkers!.length).toFixed(2)
    ),
    disallowedMarkersFound,
    noiseFiles,
    distinctFiles: distinctPaths.length,
    gapFlags
  };
}

async function main(): Promise<void> {
  const reports: CaseReport[] = [];

  for (const testCase of CASES) {
    const [grep, shallow, deep] = await Promise.all([
      runGrep(testCase.query),
      runShallow(testCase.query),
      runDeep(testCase.query)
    ]);

    reports.push({
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      notes: testCase.notes,
      results: [grep, shallow, deep].map((result) => analyzeCase(testCase, result))
    });
  }

  const gapSummary: Record<MethodName, Record<string, number>> = {
    grep: {},
    shallow: {},
    deep: {}
  };

  for (const report of reports) {
    for (const result of report.results) {
      for (const flag of result.gapFlags) {
        gapSummary[result.method][flag] = (gapSummary[result.method][flag] ?? 0) + 1;
      }
    }
  }

  console.log(JSON.stringify({ reports, gapSummary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

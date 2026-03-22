import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
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
const BASELINE_MAX_FILES = 3;
const BASELINE_CONTEXT_WINDOW = 800;

type MethodName = "cli_baseline" | "search_context" | "deep_search_context";

interface BenchmarkCase {
  id: number;
  query: string;
  expectedFiles: string[];
  markers: string[];
}

interface RetrievalResult {
  method: MethodName;
  elapsedMs: number;
  commandCount: number;
  charsReturned: number;
  paths: string[];
  text: string;
}

interface MethodScore {
  method: MethodName;
  elapsedMs: number;
  commandCount: number;
  charsReturned: number;
  expectedFilesMatched: string[];
  matchedMarkers: string[];
  distinctFiles: number;
  noiseFiles: string[];
  qualityScore: number;
  efficiencyScore: number;
}

const CASES: BenchmarkCase[] = [
  {
    id: 1,
    query: "What happened to Oathfen after the Sable Flood?",
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["abandoned", "Oathfen Crossing", "mud and memory", "crossing rather than town"]
  },
  {
    id: 2,
    query: "Was the Lantern of Saint Tol actually moved during the flood?",
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["taken south", "sealed crate", "uncertain", "not the Lantern", "deny only certainty"]
  },
  {
    id: 3,
    query: 'What is the "ninth chain"?',
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/06_interrogation_of_ferryman_joss_orrel.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["survey interval", "ferry chain", "symbolic phrase", "west of where", "deny"]
  },
  {
    id: 4,
    query: "Did Concord officials chain bodies to a tower?",
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/06_interrogation_of_ferryman_joss_orrel.txt",
      "mireglass_test/08_tavern_broadsides_and_street_songs.txt"
    ],
    markers: ["bodies chained", "panic rumors", "unreliable drunk", "official histories", "No bodies were discovered"]
  },
  {
    id: 5,
    query: 'What does "measured falsely" mean in political context?',
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/02_field_guide_to_the_mireglass_marches.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["moral accusation", "arithmetic", "survey baselines", "toll or land-rights quarrel", "measured falsely"]
  },
  {
    id: 6,
    query: "Is the Glass Bell of Nacre Ford a real object?",
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["Likely apocryphal", "No glass bell listed", "peasant mysticism", "sound phenomenon", "not in current possession"]
  },
  {
    id: 7,
    query: "Who was Joss Orrel, and why was he discredited?",
    expectedFiles: [
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/06_interrogation_of_ferryman_joss_orrel.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["Black Joss", "unreliable drunk", "false testimony", "strike as unreliable", "ferryman"]
  },
  {
    id: 8,
    query: "Are the Ash Votaries monks?",
    expectedFiles: [
      "mireglass_test/01_chronicle_of_the_sable_flood.txt",
      "mireglass_test/02_field_guide_to_the_mireglass_marches.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["not monks", "lay militia", "lay militant devotional order", "theological ambitions"]
  }
];

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "did", "do", "does", "for", "from", "happened", "how",
  "i", "in", "is", "it", "likely", "of", "on", "or", "the", "their", "to", "was", "what", "who", "why", "would"
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
    .slice(0, 6);

  const parts = [...quoted, ...words].map(escapeRegex);
  return parts.join("|");
}

function createExcerpt(content: string, queryTerms: string[]): string {
  const lowered = content.toLowerCase();
  let hitIndex = -1;

  for (const term of queryTerms) {
    hitIndex = lowered.indexOf(term.toLowerCase());
    if (hitIndex >= 0) {
      break;
    }
  }

  if (hitIndex < 0) {
    return content.slice(0, BASELINE_CONTEXT_WINDOW);
  }

  const start = Math.max(0, hitIndex - Math.floor(BASELINE_CONTEXT_WINDOW / 3));
  const end = Math.min(content.length, start + BASELINE_CONTEXT_WINDOW);
  return content.slice(start, end).trim();
}

async function runCliBaseline(query: string): Promise<RetrievalResult> {
  const pattern = deriveGrepPattern(query);
  const queryTerms = pattern.split("|").filter(Boolean).map((term) => term.replace(/\\/g, ""));
  const start = performance.now();
  const { stdout } = await execFile("rg", ["-n", "-i", pattern, CORPUS_DIR], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });

  const grouped = new Map<string, { count: number; lines: string[] }>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^(.*?):\d+:(.*)$/);
    if (!match) {
      continue;
    }
    const filePath = normalizeCorpusPath(match[1]!);
    const entry = grouped.get(filePath) ?? { count: 0, lines: [] };
    entry.count += 1;
    entry.lines.push(match[2]!.trim());
    grouped.set(filePath, entry);
  }

  const rankedPaths = [...grouped.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([filePath]) => filePath)
    .slice(0, BASELINE_MAX_FILES);

  const snippets: string[] = [];
  for (const relativePath of rankedPaths) {
    const absolutePath = path.join(CORPUS_DIR, path.basename(relativePath) === relativePath ? relativePath : relativePath.replace("mireglass_test/", ""));
    const fileText = await fs.readFile(absolutePath, "utf8");
    const excerpt = createExcerpt(fileText, queryTerms);
    snippets.push(`${relativePath}\n${excerpt}`);
  }

  const elapsedMs = performance.now() - start;
  const text = snippets.join("\n");

  return {
    method: "cli_baseline",
    elapsedMs,
    commandCount: 1 + rankedPaths.length,
    charsReturned: text.length,
    paths: rankedPaths,
    text
  };
}

async function runSearchContext(query: string): Promise<RetrievalResult> {
  const store = await createStore();
  const start = performance.now();
  const vector = await embedQuery(query);
  const hits = await store.search(vector, { queryText: query, rootIds: [ROOT_ID] }, 8);
  const bundle = buildContextBundle(query, hits, 12000);
  const elapsedMs = performance.now() - start;
  const text = bundle.results.map((item) => `${item.relativePath}\n${item.content}`).join("\n");

  return {
    method: "search_context",
    elapsedMs,
    commandCount: 1,
    charsReturned: bundle.totalChars,
    paths: bundle.results.map((item) => item.relativePath),
    text
  };
}

async function runDeepSearchContext(query: string): Promise<RetrievalResult> {
  const start = performance.now();
  const result = await deepSearchContext(query, {
    rootIds: [ROOT_ID],
    perQueryLimit: 6,
    finalLimit: 10,
    maxChars: 16000
  });
  const elapsedMs = performance.now() - start;
  const text = result.bundle.results.map((item) => `${item.relativePath}\n${item.content}`).join("\n");

  return {
    method: "deep_search_context",
    elapsedMs,
    commandCount: 1,
    charsReturned: result.bundle.totalChars,
    paths: result.bundle.results.map((item) => item.relativePath),
    text
  };
}

function scoreResult(testCase: BenchmarkCase, result: RetrievalResult): MethodScore {
  const distinctFiles = [...new Set(result.paths)];
  const lowered = result.text.toLowerCase();
  const expectedFilesMatched = testCase.expectedFiles.filter((filePath) => distinctFiles.includes(filePath));
  const matchedMarkers = testCase.markers.filter((marker) => lowered.includes(marker.toLowerCase()));
  const noiseFiles = distinctFiles.filter((filePath) => NOISE_FILES.has(filePath));

  const coverage = expectedFilesMatched.length / testCase.expectedFiles.length;
  const markerCoverage = matchedMarkers.length / testCase.markers.length;
  const precision = distinctFiles.length === 0 ? 0 : expectedFilesMatched.length / distinctFiles.length;
  const noisePenalty = noiseFiles.length * 0.12;
  const charsPenalty = Math.min(0.2, result.charsReturned / 60000);
  const commandPenalty = Math.max(0, (result.commandCount - 1) * 0.08);
  const latencyPenalty = Math.min(0.25, result.elapsedMs / 12000);
  const qualityScore = Math.max(0, coverage * 0.5 + markerCoverage * 0.3 + precision * 0.2 - noisePenalty);
  const efficiencyScore = Math.max(0, qualityScore - charsPenalty - commandPenalty - latencyPenalty);

  return {
    method: result.method,
    elapsedMs: Math.round(result.elapsedMs),
    commandCount: result.commandCount,
    charsReturned: result.charsReturned,
    expectedFilesMatched,
    matchedMarkers,
    distinctFiles: distinctFiles.length,
    noiseFiles,
    qualityScore: Number(qualityScore.toFixed(3)),
    efficiencyScore: Number(efficiencyScore.toFixed(3))
  };
}

async function main(): Promise<void> {
  const summary: Array<{
    id: number;
    query: string;
    winnerByQuality: MethodName;
    winnerByEfficiency: MethodName;
    methods: MethodScore[];
  }> = [];

  for (const testCase of CASES) {
    const baseline = await runCliBaseline(testCase.query);
    const searchContext = await runSearchContext(testCase.query);
    const deepContext = await runDeepSearchContext(testCase.query);
    const methods = [
      scoreResult(testCase, baseline),
      scoreResult(testCase, searchContext),
      scoreResult(testCase, deepContext)
    ];
    const byQuality = [...methods].sort((a, b) => b.qualityScore - a.qualityScore);
    const byEfficiency = [...methods].sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    summary.push({
      id: testCase.id,
      query: testCase.query,
      winnerByQuality: byQuality[0]!.method,
      winnerByEfficiency: byEfficiency[0]!.method,
      methods
    });
  }

  const aggregates: Record<MethodName, { quality: number; efficiency: number; latency: number; chars: number; commands: number; qualityWins: number; efficiencyWins: number }> = {
    cli_baseline: { quality: 0, efficiency: 0, latency: 0, chars: 0, commands: 0, qualityWins: 0, efficiencyWins: 0 },
    search_context: { quality: 0, efficiency: 0, latency: 0, chars: 0, commands: 0, qualityWins: 0, efficiencyWins: 0 },
    deep_search_context: { quality: 0, efficiency: 0, latency: 0, chars: 0, commands: 0, qualityWins: 0, efficiencyWins: 0 }
  };

  for (const item of summary) {
    aggregates[item.winnerByQuality].qualityWins += 1;
    aggregates[item.winnerByEfficiency].efficiencyWins += 1;

    for (const method of item.methods) {
      aggregates[method.method].quality += method.qualityScore;
      aggregates[method.method].efficiency += method.efficiencyScore;
      aggregates[method.method].latency += method.elapsedMs;
      aggregates[method.method].chars += method.charsReturned;
      aggregates[method.method].commands += method.commandCount;
    }
  }

  const averages = Object.fromEntries(
    Object.entries(aggregates).map(([method, totals]) => [
      method,
      {
        averageQuality: Number((totals.quality / CASES.length).toFixed(3)),
        averageEfficiency: Number((totals.efficiency / CASES.length).toFixed(3)),
        averageLatencyMs: Number((totals.latency / CASES.length).toFixed(1)),
        averageCharsReturned: Number((totals.chars / CASES.length).toFixed(1)),
        averageCommandCount: Number((totals.commands / CASES.length).toFixed(2)),
        qualityWins: totals.qualityWins,
        efficiencyWins: totals.efficiencyWins
      }
    ])
  );

  console.log(JSON.stringify({ summary, averages }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

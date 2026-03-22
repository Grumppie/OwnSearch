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

interface BenchmarkCase {
  id: number;
  query: string;
  expectedFiles: string[];
  markers: string[];
}

interface RetrievalResult {
  method: MethodName;
  elapsedMs: number;
  paths: string[];
  snippets: string[];
}

interface MethodScore {
  method: MethodName;
  elapsedMs: number;
  expectedFilesMatched: string[];
  matchedMarkers: string[];
  distinctFiles: number;
  noiseFiles: string[];
  coverageScore: number;
  markerScore: number;
  precisionScore: number;
  latencyScore: number;
  noisePenalty: number;
  totalScore: number;
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
  },
  {
    id: 9,
    query: "What route would smugglers likely use to avoid Merovin toll control?",
    expectedFiles: [
      "mireglass_test/02_field_guide_to_the_mireglass_marches.txt",
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["Hollow Delta", "Saint Tol Ladder", "Merovin charter", "used by smugglers"]
  },
  {
    id: 10,
    query: "Which sources are most trustworthy about relic inventories?",
    expectedFiles: [
      "mireglass_test/03_concord_ledger_extracts.txt",
      "mireglass_test/04_red_abbey_homilies_and_relic_notes.txt",
      "mireglass_test/05_merovin_correspondence_on_river_rights.txt",
      "mireglass_test/07_glossary_aliases_and_disputed_terms.txt"
    ],
    markers: ["Inventory discrepancy", "inventory tradition", "contents were not examined", "not the Lantern", "not in current possession"]
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

async function runGrep(query: string): Promise<RetrievalResult> {
  const pattern = deriveGrepPattern(query);
  const start = performance.now();
  const { stdout } = await execFile("rg", ["-n", "-i", pattern, CORPUS_DIR], { windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
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
  const snippets = paths.map((filePath) => `${filePath}\n${(grouped.get(filePath) ?? []).slice(0, 3).join("\n")}`);

  return {
    method: "grep",
    elapsedMs,
    paths,
    snippets
  };
}

async function runShallow(query: string): Promise<RetrievalResult> {
  const store = await createStore();
  const start = performance.now();
  const vector = await embedQuery(query);
  const hits = await store.search(vector, { queryText: query, rootIds: [ROOT_ID] }, 8);
  const bundle = buildContextBundle(query, hits, 12000);
  const elapsedMs = performance.now() - start;

  return {
    method: "shallow",
    elapsedMs,
    paths: bundle.results.map((item) => item.relativePath),
    snippets: bundle.results.map((item) => `${item.relativePath}\n${item.content}`)
  };
}

async function runDeep(query: string): Promise<RetrievalResult> {
  const start = performance.now();
  const result = await deepSearchContext(query, { rootIds: [ROOT_ID], perQueryLimit: 6, finalLimit: 10, maxChars: 16000 });
  const elapsedMs = performance.now() - start;

  return {
    method: "deep",
    elapsedMs,
    paths: result.bundle.results.map((item) => item.relativePath),
    snippets: result.bundle.results.map((item) => `${item.relativePath}\n${item.content}`)
  };
}

function scoreResult(testCase: BenchmarkCase, result: RetrievalResult, fastestMs: number): MethodScore {
  const text = result.snippets.join("\n").toLowerCase();
  const distinctFiles = [...new Set(result.paths)];
  const expectedFilesMatched = testCase.expectedFiles.filter((filePath) => distinctFiles.includes(filePath));
  const matchedMarkers = testCase.markers.filter((marker) => text.includes(marker.toLowerCase()));
  const noiseFiles = distinctFiles.filter((filePath) => NOISE_FILES.has(filePath));

  const coverageScore = (expectedFilesMatched.length / testCase.expectedFiles.length) * 50;
  const markerScore = (matchedMarkers.length / testCase.markers.length) * 25;
  const precisionScore = distinctFiles.length === 0 ? 0 : (expectedFilesMatched.length / distinctFiles.length) * 15;
  const latencyScore = fastestMs <= 0 ? 0 : Math.min(10, (fastestMs / result.elapsedMs) * 10);
  const noisePenalty = noiseFiles.length * 5;
  const totalScore = coverageScore + markerScore + precisionScore + latencyScore - noisePenalty;

  return {
    method: result.method,
    elapsedMs: Math.round(result.elapsedMs),
    expectedFilesMatched,
    matchedMarkers,
    distinctFiles: distinctFiles.length,
    noiseFiles,
    coverageScore: Number(coverageScore.toFixed(2)),
    markerScore: Number(markerScore.toFixed(2)),
    precisionScore: Number(precisionScore.toFixed(2)),
    latencyScore: Number(latencyScore.toFixed(2)),
    noisePenalty,
    totalScore: Number(totalScore.toFixed(2))
  };
}

async function main(): Promise<void> {
  const summary: Array<{
    id: number;
    query: string;
    winner: MethodName;
    methods: MethodScore[];
  }> = [];

  for (const testCase of CASES) {
    const grep = await runGrep(testCase.query);
    const shallow = await runShallow(testCase.query);
    const deep = await runDeep(testCase.query);
    const fastestMs = Math.min(grep.elapsedMs, shallow.elapsedMs, deep.elapsedMs);
    const methods = [
      scoreResult(testCase, grep, fastestMs),
      scoreResult(testCase, shallow, fastestMs),
      scoreResult(testCase, deep, fastestMs)
    ].sort((a, b) => b.totalScore - a.totalScore);

    summary.push({
      id: testCase.id,
      query: testCase.query,
      winner: methods[0]!.method,
      methods
    });
  }

  const aggregate = {
    grep: 0,
    shallow: 0,
    deep: 0
  };

  for (const row of summary) {
    for (const method of row.methods) {
      aggregate[method.method] += method.totalScore;
    }
  }

  const averages = Object.fromEntries(
    Object.entries(aggregate).map(([method, total]) => [method, Number((total / CASES.length).toFixed(2))])
  );

  console.log(JSON.stringify({ summary, averages }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

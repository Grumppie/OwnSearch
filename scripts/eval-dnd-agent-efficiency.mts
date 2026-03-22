import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadOwnSearchEnv } from "../src/config.js";
import { buildContextBundle } from "../src/context.js";
import { collectTextFiles, type FileCandidate } from "../src/files.js";
import { embedQuery } from "../src/gemini.js";
import { createStore } from "../src/qdrant.js";
import { deepSearchContext } from "../src/retrieval.js";

loadOwnSearchEnv();

const ROOT_ID = "testing-c-users-dell-desktop-projects-ownsearch-testing";
const PATH_SUBSTRING = "dnd_test/";
const CORPUS_DIR = path.resolve("_testing", "dnd_test");
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const BASELINE_MAX_FILES = 3;
const BASELINE_CONTEXT_WINDOW = 1200;

type MethodName = "cli_extract_cold" | "cli_extract_warm" | "search_context" | "deep_search_context";

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
  qualityScore: number;
  efficiencyScore: number;
}

const CASES: BenchmarkCase[] = [
  {
    id: 1,
    query: "How does concentration work?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf"
    ],
    markers: ["casting another spell", "taking damage", "constitution saving throw", "incapacitated or killed"]
  },
  {
    id: 2,
    query: "What is the spell save DC formula?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf"
    ],
    markers: ["8 + your proficiency bonus", "spellcasting ability modifier", "spell attack modifier"]
  },
  {
    id: 3,
    query: "How do death saving throws work?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf"
    ],
    markers: ["three successes", "three failures", "regain 1 hit point"]
  },
  {
    id: 4,
    query: "How does cover work?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf",
      "dnd_test/D&D 5e - DM's Basic Rules v 0.3.pdf"
    ],
    markers: ["half cover", "three-quarters cover", "total cover", "+2 bonus to ac", "+5 bonus to ac"]
  },
  {
    id: 5,
    query: "How do advantage and disadvantage work?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf"
    ],
    markers: ["higher of the two rolls", "lower of the two rolls", "have neither"]
  },
  {
    id: 6,
    query: "How do grappling and shoving work?",
    expectedFiles: [
      "dnd_test/phb.pdf",
      "dnd_test/PlayerDnDBasicRules_v0.2.pdf"
    ],
    markers: ["special melee attack", "speed becomes 0", "push it 5 feet", "knock it prone"]
  }
];

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "do", "does", "how", "i", "in", "is", "it", "of", "the", "to", "what", "work"
]);

let warmCorpus: FileCandidate[] | undefined;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9+_-]+/)
    .filter((token) => token && !STOPWORDS.has(token));
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  const loweredHaystack = haystack.toLowerCase();
  const loweredNeedle = needle.toLowerCase();

  while ((index = loweredHaystack.indexOf(loweredNeedle, index)) >= 0) {
    count += 1;
    index += loweredNeedle.length;
  }

  return count;
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
    return content.slice(0, BASELINE_CONTEXT_WINDOW).trim();
  }

  const start = Math.max(0, hitIndex - Math.floor(BASELINE_CONTEXT_WINDOW / 3));
  const end = Math.min(content.length, start + BASELINE_CONTEXT_WINDOW);
  return content.slice(start, end).trim();
}

function lexicalRank(files: FileCandidate[], query: string): Array<{ file: FileCandidate; score: number }> {
  const queryTerms = tokenizeQuery(query);
  const phrase = query.toLowerCase().replace(/[?"]/g, "").trim();

  return files
    .map((file) => {
      const lowered = file.content.toLowerCase();
      const termScore = queryTerms.reduce((sum, term) => sum + countOccurrences(lowered, term), 0);
      const phraseScore = phrase ? countOccurrences(lowered, phrase) * 4 : 0;
      return {
        file,
        score: termScore + phraseScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function getWarmCorpus(): Promise<FileCandidate[]> {
  if (!warmCorpus) {
    warmCorpus = await collectTextFiles(CORPUS_DIR, MAX_FILE_BYTES);
  }
  return warmCorpus;
}

async function runCliExtractBaseline(query: string, mode: "cold" | "warm"): Promise<RetrievalResult> {
  const start = performance.now();
  const files = mode === "cold"
    ? await collectTextFiles(CORPUS_DIR, MAX_FILE_BYTES)
    : await getWarmCorpus();

  const ranked = lexicalRank(files, query).slice(0, BASELINE_MAX_FILES);
  const queryTerms = tokenizeQuery(query);
  const snippets = ranked.map(({ file }) => `${normalizeRelativePath(path.join("dnd_test", path.basename(file.relativePath)))}\n${createExcerpt(file.content, queryTerms)}`);
  const text = snippets.join("\n");
  const elapsedMs = performance.now() - start;

  return {
    method: mode === "cold" ? "cli_extract_cold" : "cli_extract_warm",
    elapsedMs,
    commandCount: 1 + ranked.length,
    charsReturned: text.length,
    paths: ranked.map(({ file }) => normalizeRelativePath(path.join("dnd_test", path.basename(file.relativePath)))),
    text
  };
}

async function runSearchContext(query: string): Promise<RetrievalResult> {
  const store = await createStore();
  const start = performance.now();
  const vector = await embedQuery(query);
  const hits = await store.search(
    vector,
    {
      queryText: query,
      rootIds: [ROOT_ID],
      pathSubstring: PATH_SUBSTRING
    },
    8
  );
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
    pathSubstring: PATH_SUBSTRING,
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

  const coverage = expectedFilesMatched.length / testCase.expectedFiles.length;
  const markerCoverage = matchedMarkers.length / testCase.markers.length;
  const precision = distinctFiles.length === 0 ? 0 : expectedFilesMatched.length / distinctFiles.length;
  const charsPenalty = Math.min(0.2, result.charsReturned / 80000);
  const commandPenalty = Math.max(0, (result.commandCount - 1) * 0.08);
  const latencyPenalty = Math.min(0.35, result.elapsedMs / 25000);
  const qualityScore = coverage * 0.5 + markerCoverage * 0.3 + precision * 0.2;
  const efficiencyScore = Math.max(0, qualityScore - charsPenalty - commandPenalty - latencyPenalty);

  return {
    method: result.method,
    elapsedMs: Math.round(result.elapsedMs),
    commandCount: result.commandCount,
    charsReturned: result.charsReturned,
    expectedFilesMatched,
    matchedMarkers,
    distinctFiles: distinctFiles.length,
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

  await getWarmCorpus();

  for (const testCase of CASES) {
    const cold = await runCliExtractBaseline(testCase.query, "cold");
    const warm = await runCliExtractBaseline(testCase.query, "warm");
    const searchContext = await runSearchContext(testCase.query);
    const deep = await runDeepSearchContext(testCase.query);

    const methods = [
      scoreResult(testCase, cold),
      scoreResult(testCase, warm),
      scoreResult(testCase, searchContext),
      scoreResult(testCase, deep)
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
    cli_extract_cold: { quality: 0, efficiency: 0, latency: 0, chars: 0, commands: 0, qualityWins: 0, efficiencyWins: 0 },
    cli_extract_warm: { quality: 0, efficiency: 0, latency: 0, chars: 0, commands: 0, qualityWins: 0, efficiencyWins: 0 },
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

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deleteRootDefinition, findRoot, loadConfig, loadOwnSearchEnv } from "../config.js";
import { buildContextBundle } from "../context.js";
import { OwnSearchError } from "../errors.js";
import { embedQuery } from "../gemini.js";
import { indexPath } from "../indexer.js";
import { literalSearch } from "../literal-search.js";
import { createStore } from "../qdrant.js";
import { deepSearchContext } from "../retrieval.js";

loadOwnSearchEnv();

const BUNDLED_SKILL_NAME = "ownsearch-rag-search";
const SERVER_VERSION = "0.1.8";
const SKILL_RESOURCE_URI = "ownsearch://skills/retrieval";

function packageRootFromCurrentFile() {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
}

function skillResourceText(skillName: string, skill: string) {
  return [
    `OwnSearch Retrieval Skill: ${skillName}`,
    "",
    "Use this guidance before retrieval-heavy work when you need to decide between literal_search, search_context, deep_search_context, search, and get_chunks.",
    "",
    skill
  ].join("\n");
}

function promptInstructionText() {
  return [
    "You are using OwnSearch MCP tools for grounded local retrieval.",
    "",
    "Default playbook:",
    "1. Read the retrieval skill resource or call get_retrieval_skill once if you have not loaded it yet.",
    "2. Use literal_search for exact names, titles, IDs, quoted phrases, or other grep-style lookups.",
    "3. Use search_context for normal grounded QA.",
    "4. Use deep_search_context for archive-style, ambiguous, or multi-document questions.",
    "5. Use search to inspect ranking and source spread.",
    "6. Use get_chunks before making exact wording claims.",
    "",
    "Answer only from retrieved evidence. If evidence conflicts or is partial, say so explicitly."
  ].join("\n");
}

function toolResult(summary: string, data: unknown, nextActions: string[] = []) {
  const payload = {
    summary,
    nextActions,
    data
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnosis = diagnoseError(message);
  const payload = {
    summary: diagnosis.summary,
    error: message,
    nextActions: diagnosis.nextActions
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload,
    isError: true
  };
}

async function readBundledSkill(skillName: string): Promise<string> {
  const packageRoot = packageRootFromCurrentFile();
  const skillPath = path.join(packageRoot, "skills", skillName, "SKILL.md");
  return fs.readFile(skillPath, "utf8");
}

function diagnoseError(message: string): { summary: string; nextActions: string[] } {
  const lower = message.toLowerCase();

  if (lower.includes("gemini_api_key")) {
    return {
      summary: "Gemini API key is missing.",
      nextActions: [
        "Run `ownsearch setup` in a normal terminal and complete Gemini key setup.",
        "If this MCP server is running in a restricted environment, ensure it can read ~/.ownsearch/.env or receive GEMINI_API_KEY in its process environment."
      ]
    };
  }

  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("timeout")) {
    return {
      summary: "OwnSearch could not reach Gemini or Qdrant from this execution environment.",
      nextActions: [
        "Check whether the MCP server is running in a sandboxed or restricted environment.",
        "Verify Gemini API access works in a normal terminal with `ownsearch doctor`.",
        "Verify local Qdrant is reachable at the configured URL."
      ]
    };
  }

  if (lower.includes("unknown root")) {
    return {
      summary: "The requested root ID does not exist.",
      nextActions: [
        "Call `list_roots` to get valid root IDs.",
        "If the folder was not indexed yet, call `index_path` first."
      ]
    };
  }

  if (lower.includes("qdrant")) {
    return {
      summary: "Qdrant is not reachable or is misconfigured.",
      nextActions: [
        "Run `ownsearch setup` or `ownsearch doctor` in a normal terminal.",
        "Confirm Docker is running and Qdrant is reachable at the configured URL."
      ]
    };
  }

  return {
    summary: "OwnSearch tool call failed.",
    nextActions: [
      "Inspect the error message below.",
      "If this is an environment issue, retry in a normal terminal outside the agent sandbox."
    ]
  };
}

const server = new McpServer(
  {
    name: "ownsearch",
    version: SERVER_VERSION
  }
);

server.registerResource(
  "ownsearch-retrieval-skill",
  SKILL_RESOURCE_URI,
  {
    title: "OwnSearch Retrieval Skill",
    description: "Bundled retrieval playbook that explains when to use literal_search, search_context, deep_search_context, search, and get_chunks.",
    mimeType: "text/markdown"
  },
  async () => {
    const skill = await readBundledSkill(BUNDLED_SKILL_NAME);
    return {
      contents: [
        {
          uri: SKILL_RESOURCE_URI,
          mimeType: "text/markdown",
          text: skillResourceText(BUNDLED_SKILL_NAME, skill)
        }
      ]
    };
  }
);

server.registerPrompt(
  "ownsearch-retrieval-guide",
  {
    title: "OwnSearch Retrieval Guide",
    description: "Short operational prompt that tells an agent how to use OwnSearch retrieval tools effectively."
  },
  async () => ({
    description: "Short guide for using OwnSearch tools well.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: promptInstructionText()
        }
      }
    ]
  })
);

server.registerTool(
  "get_retrieval_skill",
  {
    title: "Get Retrieval Skill",
    description: "Read the bundled OwnSearch retrieval skill. Call this first if you want explicit guidance on query rewriting, search strategy, grounded answering, and failure recovery.",
    inputSchema: {
      skillName: z.string().optional().describe(`Optional skill name. Default is ${BUNDLED_SKILL_NAME}.`)
    }
  },
  async ({ skillName }) => {
    try {
      const resolvedSkillName = skillName?.trim() || BUNDLED_SKILL_NAME;
      const skill = await readBundledSkill(resolvedSkillName);
      return toolResult(
        `Loaded bundled retrieval skill ${resolvedSkillName}.`,
        {
          skillName: resolvedSkillName,
          skill,
          resourceUri: SKILL_RESOURCE_URI,
          promptName: "ownsearch-retrieval-guide"
        },
        [
          "If your MCP client supports resources, read `ownsearch://skills/retrieval` to keep this guidance in working context.",
          "If your MCP client supports prompts, use `ownsearch-retrieval-guide` for a shorter operational playbook.",
          "Prefer `search_context` for grounded answering and `get_chunks` when exact wording matters."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "index_path",
  {
    title: "Index Path",
    description: "Index an approved local folder recursively, including nested subfolders. Use this before search. Returns the registered root and indexing counts.",
    inputSchema: {
      path: z.string().describe("Absolute or relative folder path to index."),
      name: z.string().optional().describe("Optional display name for this indexed root.")
    }
  },
  async ({ path: indexTargetPath, name }) => {
    try {
      const result = await indexPath(indexTargetPath, { name });
      return toolResult(
        `Indexed folder ${indexTargetPath}.`,
        result,
        [
          "If you have not loaded the OwnSearch guidance yet, read the `ownsearch://skills/retrieval` resource or call `get_retrieval_skill` once.",
          "Use `list_roots` to confirm the registered root ID if you need scoped search.",
          "Then call `search_context` for grounded retrieval or `search` for ranked hits."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "search",
  {
    title: "Semantic Search",
    description: "Semantic search over one root or the full local store. Use `rootIds` when you want deterministic scope. If you do not know the root ID yet, call `list_roots` first.",
    inputSchema: {
      query: z.string().describe("Natural language search query."),
      rootIds: z.array(z.string()).optional().describe("Optional list of root IDs to restrict search."),
      limit: z.number().optional().describe("Maximum result count. Default 5."),
      pathSubstring: z.string().optional().describe("Optional file path substring filter.")
    }
  },
  async ({ query, rootIds, limit, pathSubstring }) => {
    try {
      const vector = await embedQuery(query);
      const store = await createStore();
      const hits = await store.search(
        vector,
        { queryText: query, rootIds, pathSubstring },
        Math.max(1, Math.min(limit ?? 5, 20))
      );

      if (hits.length === 0) {
        return toolResult(
          "Search completed but returned no results.",
          { query, hits },
          [
            "If you intended to search one indexed folder, call `list_roots` and confirm the correct `rootIds` value.",
            "If indexing may have been interrupted, call `index_path` again for that folder.",
            "If this server is running in a restricted environment and earlier calls showed `fetch failed`, verify Gemini and Qdrant connectivity outside the sandbox."
          ]
        );
      }

      return toolResult(
        `Search returned ${hits.length} hit(s).`,
        { query, hits },
        [
          "Use `literal_search` instead when the user gives strong exact strings, IDs, names, or titles.",
          "If you have not read the OwnSearch retrieval guidance yet, read `ownsearch://skills/retrieval` or call `get_retrieval_skill`.",
          "Use `search_context` if you want a compact grounded bundle for answering.",
          "Use `get_chunks` on selected hit IDs when exact wording matters."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "literal_search",
  {
    title: "Literal Search",
    description: "Exact text search backed by ripgrep. Prefer this for strong keywords, exact names, IDs, error strings, titles, or other literal queries where grep-style matching is better than semantic retrieval.",
    inputSchema: {
      query: z.string().describe("Exact text to search for."),
      rootIds: z.array(z.string()).optional().describe("Optional list of root IDs to restrict search."),
      pathSubstring: z.string().optional().describe("Optional file path substring filter."),
      limit: z.number().optional().describe("Maximum result count. Default 20.")
    }
  },
  async ({ query, rootIds, pathSubstring, limit }) => {
    try {
      const matches = await literalSearch({
        query,
        rootIds,
        pathSubstring,
        limit
      });

      if (matches.length === 0) {
        return toolResult(
          "Literal search completed but returned no exact matches.",
          { query, matches },
          [
            "If the user request is more conceptual or paraphrased, switch to `search_context` or `deep_search_context`.",
            "If you expected a scoped result, call `list_roots` and verify the correct root ID."
          ]
        );
      }

      return toolResult(
        `Literal search returned ${matches.length} exact match(es).`,
        { query, matches },
        [
          "Use these results when exact wording, names, IDs, or titles matter.",
          "Switch to `search_context` or `deep_search_context` if you need semantic expansion or multi-document synthesis."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "search_context",
  {
    title: "Search Context",
    description: "Search and return a grounded context bundle for answer synthesis. Prefer this for question answering.",
    inputSchema: {
      query: z.string().describe("Natural language search query."),
      rootIds: z.array(z.string()).optional().describe("Optional list of root IDs to restrict search."),
      limit: z.number().optional().describe("Maximum search hits to consider. Default 8."),
      maxChars: z.number().optional().describe("Maximum total characters of bundled context. Default 12000."),
      pathSubstring: z.string().optional().describe("Optional file path substring filter.")
    }
  },
  async ({ query, rootIds, limit, maxChars, pathSubstring }) => {
    try {
      const vector = await embedQuery(query);
      const store = await createStore();
      const hits = await store.search(
        vector,
        { queryText: query, rootIds, pathSubstring },
        Math.max(1, Math.min(limit ?? 8, 20))
      );

      if (hits.length === 0) {
        return toolResult(
          "Context search completed but returned no results.",
          {
            query,
            totalChars: 0,
            results: []
          },
          [
            "Call `list_roots` to confirm the target root ID.",
            "Retry `search` with the same query to inspect raw hits.",
            "If indexing may not have completed, call `index_path` again for the folder."
          ]
        );
      }

      const bundle = buildContextBundle(query, hits, Math.max(500, maxChars ?? 12000));
      return toolResult(
        `Context bundle built from ${bundle.results.length} result block(s).`,
        bundle,
        [
          "Use `literal_search` first when the query contains a strong exact string or title.",
          "If retrieval planning is weak or ambiguous, read `ownsearch://skills/retrieval` or call `get_retrieval_skill` for guidance.",
          "Answer using only the returned context when possible.",
          "If you need exact source text, call `get_chunks` with the contributing chunk IDs from `search`."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "deep_search_context",
  {
    title: "Deep Search Context",
    description: "Run a deeper multi-query retrieval pass for archive-style, ambiguous, or recall-heavy questions. This expands the query, searches multiple variants, diversifies sources, and returns a richer grounded bundle.",
    inputSchema: {
      query: z.string().describe("Natural language question or concept to investigate."),
      rootIds: z.array(z.string()).optional().describe("Optional list of root IDs to restrict search."),
      pathSubstring: z.string().optional().describe("Optional file path substring filter."),
      perQueryLimit: z.number().optional().describe("Max hits per query variant. Default 6."),
      finalLimit: z.number().optional().describe("Max final aggregated hits. Default 10."),
      maxChars: z.number().optional().describe("Max total characters in the returned context bundle. Default 16000.")
    }
  },
  async ({ query, rootIds, pathSubstring, perQueryLimit, finalLimit, maxChars }) => {
    try {
      const result = await deepSearchContext(query, {
        rootIds,
        pathSubstring,
        perQueryLimit,
        finalLimit,
        maxChars
      });

      if (result.bundle.results.length === 0) {
        return toolResult(
          "Deep retrieval completed but still found no grounded evidence.",
          result,
          [
            "Call `list_roots` to confirm the root scope.",
            "Retry with a shorter or more literal query.",
            "If the corpus was indexed recently, call `index_path` again to ensure indexing completed."
          ]
        );
      }

      return toolResult(
        `Deep retrieval built a richer bundle from ${result.distinctFiles} distinct file(s) across ${result.queryVariants.length} query variant(s).`,
        result,
        [
          "Use `literal_search` instead when the user gives a precise title, error string, or identifier.",
          "Use this result for archive-style or multi-document synthesis.",
          "If you need exact wording, follow up with `search` and `get_chunks` on the strongest source files."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_chunks",
  {
    title: "Get Chunks",
    description: "Fetch exact indexed chunks by id after `search` or `search_context`. Use this when exact wording matters.",
    inputSchema: {
      ids: z.array(z.string()).describe("Chunk ids returned by search.")
    }
  },
  async ({ ids }) => {
    try {
      const store = await createStore();
      const chunks = await store.getChunks(ids);
      return toolResult(
        `Fetched ${chunks.length} chunk(s).`,
        { chunks },
        chunks.length
          ? ["Use these exact chunks when precise quoting or comparison matters."]
          : ["No matching chunk IDs were found. Re-run `search` and use returned hit IDs."]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_roots",
  {
    title: "List Roots",
    description: "List indexed roots with their IDs. Use this before scoped search if you only know the human-readable folder name."
  },
  async () => {
    try {
      const config = await loadConfig();
      return toolResult(
        `Found ${config.roots.length} indexed root(s).`,
        { roots: config.roots },
        config.roots.length
          ? ["Use the returned `id` values in `search`, `literal_search`, or `search_context` when you want scoped retrieval."]
          : ["No roots are indexed yet. Call `index_path` on a local folder first."]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_root",
  {
    title: "Delete Root",
    description: "Delete one indexed root from config and vector storage. This removes its indexed vectors.",
    inputSchema: {
      rootId: z.string().describe("Root identifier returned by list_roots.")
    }
  },
  async ({ rootId }) => {
    try {
      const root = await findRoot(rootId);
      if (!root) {
        throw new OwnSearchError(`Unknown root: ${rootId}`);
      }

      const store = await createStore();
      await store.deleteRoot(root.id);
      await deleteRootDefinition(root.id);

      return toolResult(
        `Deleted root ${root.id}.`,
        {
          deleted: true,
          root
        },
        ["Call `list_roots` to confirm the remaining indexed roots."]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "store_status",
  {
    title: "Store Status",
    description: "Inspect the local Qdrant collection status. Use this for environment diagnostics when search behaves unexpectedly."
  },
  async () => {
    try {
      const store = await createStore();
      const status = await store.getStatus();
      return toolResult(
        "Retrieved vector store status.",
        status,
        [
          "If search fails, check `pointsCount`, `indexedVectorsCount`, and collection status here.",
          "Run `list_roots` next if you need to scope searches by root."
        ]
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start OwnSearch MCP server:", error);
  process.exitCode = 1;
});

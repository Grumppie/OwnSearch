#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { buildContextBundle } from "../context.js";
import { deleteRootDefinition, findRoot, loadConfig, loadOwnSearchEnv } from "../config.js";
import { OwnSearchError } from "../errors.js";
import { embedQuery } from "../gemini.js";
import { indexPath } from "../indexer.js";
import { createStore } from "../qdrant.js";

loadOwnSearchEnv();

const BUNDLED_SKILL_NAME = "ownsearch-rag-search";

function asText(result: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

function withGuidance(summary: string, data: unknown, nextActions: string[] = []) {
  return asText({
    summary,
    nextActions,
    data
  });
}

async function readBundledSkill(skillName: string): Promise<string> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFilePath), "..", "..");
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

function asError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnosis = diagnoseError(message);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          summary: diagnosis.summary,
          error: message,
          nextActions: diagnosis.nextActions
        }, null, 2)
      }
    ]
  };
}

const server = new Server(
  {
    name: "ownsearch",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_retrieval_skill",
      description: "Read the bundled OwnSearch retrieval skill. Call this first if you want explicit guidance on query rewriting, search strategy, grounded answering, and failure recovery.",
      inputSchema: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: `Optional skill name. Default is ${BUNDLED_SKILL_NAME}.`
          }
        }
      }
    },
    {
      name: "index_path",
      description: "Index an approved local folder recursively, including nested subfolders. Use this before search. Returns the registered root and indexing counts. For best retrieval behavior, read `get_retrieval_skill` once before planning search calls.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative folder path to index." },
          name: { type: "string", description: "Optional display name for this indexed root." }
        },
        required: ["path"]
      }
    },
    {
      name: "search",
      description: "Semantic search over one root or the full local store. Use `rootIds` when you want deterministic scope. If you do not know the root ID yet, call `list_roots` first.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query." },
          rootIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of root IDs to restrict search."
          },
          limit: { type: "number", description: "Maximum result count. Default 5." },
          pathSubstring: { type: "string", description: "Optional file path substring filter." }
        },
        required: ["query"]
      }
    },
    {
      name: "search_context",
      description: "Search and return a grounded context bundle for answer synthesis. Prefer this for question answering. If results are empty, check root scope, indexing completion, and environment connectivity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query." },
          rootIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of root IDs to restrict search."
          },
          limit: { type: "number", description: "Maximum search hits to consider. Default 8." },
          maxChars: { type: "number", description: "Maximum total characters of bundled context. Default 12000." },
          pathSubstring: { type: "string", description: "Optional file path substring filter." }
        },
        required: ["query"]
      }
    },
    {
      name: "get_chunks",
      description: "Fetch exact indexed chunks by id after `search` or `search_context`. Use this when exact wording matters.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Chunk ids returned by search."
          }
        },
        required: ["ids"]
      }
    },
    {
      name: "list_roots",
      description: "List indexed roots with their IDs. Use this before scoped search if you only know the human-readable folder name.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "delete_root",
      description: "Delete one indexed root from config and vector storage. This removes its indexed vectors.",
      inputSchema: {
        type: "object",
        properties: {
          rootId: { type: "string", description: "Root identifier returned by list_roots." }
        },
        required: ["rootId"]
      }
    },
    {
      name: "store_status",
      description: "Inspect the local Qdrant collection status. Use this for environment diagnostics when search behaves unexpectedly.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "get_retrieval_skill": {
        const args = request.params.arguments as { skillName?: string } | undefined;
        const skillName = args?.skillName?.trim() || BUNDLED_SKILL_NAME;
        const skill = await readBundledSkill(skillName);
        return withGuidance(
          `Loaded bundled retrieval skill ${skillName}.`,
          {
            skillName,
            skill
          },
          [
            "Use this skill to rewrite weak user requests into stronger retrieval queries.",
            "Prefer `search_context` for grounded answering and `get_chunks` when exact wording matters."
          ]
        );
      }

      case "index_path": {
        const args = request.params.arguments as { path?: string; name?: string } | undefined;
        if (!args?.path) {
          throw new OwnSearchError("`path` is required.");
        }

        const result = await indexPath(args.path, { name: args.name });
        return withGuidance(
          `Indexed folder ${args.path}.`,
          result,
          [
            `Call \`get_retrieval_skill\` once if you want explicit OwnSearch query-planning guidance.`,
            "Use `list_roots` to confirm the registered root ID if you need scoped search.",
            "Then call `search_context` for grounded retrieval or `search` for ranked hits."
          ]
        );
      }

      case "search": {
        const args = request.params.arguments as
          | { query?: string; rootIds?: string[]; limit?: number; pathSubstring?: string }
          | undefined;
        if (!args?.query) {
          throw new OwnSearchError("`query` is required.");
        }

        const vector = await embedQuery(args.query);
        const store = await createStore();
        const hits = await store.search(
          vector,
          {
            queryText: args.query,
            rootIds: args.rootIds,
            pathSubstring: args.pathSubstring
          },
          Math.max(1, Math.min(args.limit ?? 5, 20))
        );

        if (hits.length === 0) {
          return withGuidance(
            "Search completed but returned no results.",
            {
              query: args.query,
              hits
            },
            [
              "If you intended to search one indexed folder, call `list_roots` and confirm the correct `rootIds` value.",
              "If indexing may have been interrupted, call `index_path` again for that folder.",
              "If this server is running in a restricted environment and earlier calls showed `fetch failed`, verify Gemini and Qdrant connectivity outside the sandbox."
            ]
          );
        }

        return withGuidance(
          `Search returned ${hits.length} hit(s).`,
          {
            query: args.query,
            hits
          },
          [
            "If you have not read the OwnSearch retrieval guidance yet, call `get_retrieval_skill` first.",
            "Use `search_context` if you want a compact grounded bundle for answering.",
            "Use `get_chunks` on selected hit IDs when exact wording matters."
          ]
        );
      }

      case "search_context": {
        const args = request.params.arguments as
          | { query?: string; rootIds?: string[]; limit?: number; maxChars?: number; pathSubstring?: string }
          | undefined;
        if (!args?.query) {
          throw new OwnSearchError("`query` is required.");
        }

        const vector = await embedQuery(args.query);
        const store = await createStore();
        const hits = await store.search(
          vector,
          {
            queryText: args.query,
            rootIds: args.rootIds,
            pathSubstring: args.pathSubstring
          },
          Math.max(1, Math.min(args.limit ?? 8, 20))
        );

        if (hits.length === 0) {
          return withGuidance(
            "Context search completed but returned no results.",
            {
              query: args.query,
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

        const bundle = buildContextBundle(args.query, hits, Math.max(500, args.maxChars ?? 12000));
        return withGuidance(
          `Context bundle built from ${bundle.results.length} result block(s).`,
          bundle,
          [
            "If retrieval planning is weak or ambiguous, call `get_retrieval_skill` for query-rewrite guidance.",
            "Answer using only the returned context when possible.",
            "If you need exact source text, call `get_chunks` with the contributing chunk IDs from `search`."
          ]
        );
      }

      case "get_chunks": {
        const args = request.params.arguments as { ids?: string[] } | undefined;
        if (!args?.ids?.length) {
          throw new OwnSearchError("`ids` is required.");
        }

        const store = await createStore();
        const chunks = await store.getChunks(args.ids);
        return withGuidance(
          `Fetched ${chunks.length} chunk(s).`,
          { chunks },
          chunks.length
            ? ["Use these exact chunks when precise quoting or comparison matters."]
            : ["No matching chunk IDs were found. Re-run `search` and use returned hit IDs."]
        );
      }

      case "list_roots": {
        const config = await loadConfig();
        return withGuidance(
          `Found ${config.roots.length} indexed root(s).`,
          { roots: config.roots },
          config.roots.length
            ? ["Use the returned `id` values in `search` or `search_context` when you want scoped retrieval."]
            : ["No roots are indexed yet. Call `index_path` on a local folder first."]
        );
      }

      case "delete_root": {
        const args = request.params.arguments as { rootId?: string } | undefined;
        if (!args?.rootId) {
          throw new OwnSearchError("`rootId` is required.");
        }

        const root = await findRoot(args.rootId);
        if (!root) {
          throw new OwnSearchError(`Unknown root: ${args.rootId}`);
        }

        const store = await createStore();
        await store.deleteRoot(root.id);
        await deleteRootDefinition(root.id);

        return withGuidance(
          `Deleted root ${root.id}.`,
          {
            deleted: true,
            root
          },
          ["Call `list_roots` to confirm the remaining indexed roots."]
        );
      }

      case "store_status": {
        const store = await createStore();
        const status = await store.getStatus();
        return withGuidance(
          "Retrieved vector store status.",
          status,
          [
            "If search fails, check `pointsCount`, `indexedVectorsCount`, and collection status here.",
            "Run `list_roots` next if you need to scope searches by root."
          ]
        );
      }

      default:
        throw new OwnSearchError(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return asError(error);
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

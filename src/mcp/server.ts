#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildContextBundle } from "../context.js";
import { deleteRootDefinition, findRoot, loadConfig, loadOwnSearchEnv } from "../config.js";
import { OwnSearchError } from "../errors.js";
import { embedQuery } from "../gemini.js";
import { indexPath } from "../indexer.js";
import { createStore } from "../qdrant.js";

loadOwnSearchEnv();

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

function asError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message
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
      name: "index_path",
      description: "Register a local folder and sync its Gemini embedding index into Qdrant.",
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
      description: "Semantic search over one root or the full local Qdrant store.",
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
      description: "Search and return a bundled context payload with top chunks for direct agent grounding.",
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
      description: "Fetch exact indexed chunks by id after a search step.",
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
      description: "List approved indexed roots.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "delete_root",
      description: "Delete one indexed root from config and vector storage.",
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
      description: "Inspect Qdrant collection status for the local index.",
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
      case "index_path": {
        const args = request.params.arguments as { path?: string; name?: string } | undefined;
        if (!args?.path) {
          throw new OwnSearchError("`path` is required.");
        }

        const result = await indexPath(args.path, { name: args.name });
        return asText(result);
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
            rootIds: args.rootIds,
            pathSubstring: args.pathSubstring
          },
          Math.max(1, Math.min(args.limit ?? 5, 20))
        );

        return asText({
          query: args.query,
          hits
        });
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
            rootIds: args.rootIds,
            pathSubstring: args.pathSubstring
          },
          Math.max(1, Math.min(args.limit ?? 8, 20))
        );

        return asText(buildContextBundle(args.query, hits, Math.max(500, args.maxChars ?? 12000)));
      }

      case "get_chunks": {
        const args = request.params.arguments as { ids?: string[] } | undefined;
        if (!args?.ids?.length) {
          throw new OwnSearchError("`ids` is required.");
        }

        const store = await createStore();
        const chunks = await store.getChunks(args.ids);
        return asText({ chunks });
      }

      case "list_roots": {
        const config = await loadConfig();
        return asText({ roots: config.roots });
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

        return asText({
          deleted: true,
          root
        });
      }

      case "store_status": {
        const store = await createStore();
        return asText(await store.getStatus());
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

#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { buildContextBundle } from "./context.js";
import { ensureQdrantDocker } from "./docker.js";
import {
  deleteRootDefinition,
  findRoot,
  getConfigPath,
  getEnvPath,
  listRoots,
  loadConfig,
  loadOwnSearchEnv,
  saveGeminiApiKey
} from "./config.js";
import { OwnSearchError } from "./errors.js";
import { embedQuery } from "./gemini.js";
import { indexPath } from "./indexer.js";
import { createStore } from "./qdrant.js";

loadOwnSearchEnv();

const program = new Command();
const PACKAGE_NAME = "ownsearch";

function requireGeminiKey(): void {
  if (!process.env.GEMINI_API_KEY) {
    throw new OwnSearchError("Set GEMINI_API_KEY before running OwnSearch.");
  }
}

async function promptForGeminiKey(): Promise<boolean> {
  if (process.env.GEMINI_API_KEY || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const apiKey = (await rl.question(
      `Enter GEMINI_API_KEY to save in ${getEnvPath()} (leave blank to skip): `
    )).trim();

    if (!apiKey) {
      return false;
    }

    await saveGeminiApiKey(apiKey);
    process.env.GEMINI_API_KEY = apiKey;
    return true;
  } finally {
    rl.close();
  }
}

program
  .name("ownsearch")
  .description("Gemini-powered local search MCP server backed by Qdrant.")
  .version("0.1.0");

program
  .command("setup")
  .description("Create config and start a local Qdrant Docker container.")
  .action(async () => {
    const config = await loadConfig();
    const result = await ensureQdrantDocker();
    const geminiApiKeyPresent = await promptForGeminiKey();
    console.log(JSON.stringify({
      configPath: getConfigPath(),
      envPath: getEnvPath(),
      qdrantUrl: config.qdrantUrl,
      qdrantStarted: result.started,
      geminiApiKeyPresent
    }, null, 2));
    if (!geminiApiKeyPresent) {
      console.log(`GEMINI_API_KEY is not set. Re-run setup or add it to ${getEnvPath()} before indexing or search.`);
    }
  });

program
  .command("index")
  .argument("<folder>", "Folder path to index")
  .option("-n, --name <name>", "Display name for the indexed root")
  .option("--max-file-bytes <n>", "Override the file size limit for this run", (value) => Number(value))
  .description("Index a local folder into Qdrant using Gemini embeddings.")
  .action(async (folder: string, options: { name?: string; maxFileBytes?: number }) => {
    requireGeminiKey();
    const result = await indexPath(folder, {
      name: options.name,
      maxFileBytes: options.maxFileBytes
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("search")
  .argument("<query>", "Natural language query")
  .option("--root-id <rootId...>", "Restrict search to one or more root IDs (repeatable)")
  .option("--limit <n>", "Max results (default 5)", (value) => Number(value), 5)
  .option("--path <substr>", "Filter results to files whose relative path contains this substring")
  .description("Embed a query with Gemini and search the local Qdrant store.")
  .action(
    async (
      query: string,
      options: { rootId?: string[]; limit: number; path?: string }
    ) => {
      requireGeminiKey();
      const store = await createStore();
      const vector = await embedQuery(query);
      const hits = await store.search(
        vector,
        {
          rootIds: options.rootId,
          pathSubstring: options.path
        },
        Math.max(1, Math.min(options.limit ?? 5, 50))
      );

      console.log(JSON.stringify({ query, hits }, null, 2));
    }
  );

program
  .command("search-context")
  .argument("<query>", "Natural language query")
  .option("--root-id <rootId...>", "Restrict search to one or more root IDs (repeatable)")
  .option("--limit <n>", "Max search hits to consider (default 8)", (value) => Number(value), 8)
  .option("--max-chars <n>", "Max context characters to return (default 12000)", (value) => Number(value), 12000)
  .option("--path <substr>", "Filter results to files whose relative path contains this substring")
  .description("Search the local Qdrant store and return a bundled context payload for agent use.")
  .action(
    async (
      query: string,
      options: { rootId?: string[]; limit: number; maxChars: number; path?: string }
    ) => {
      requireGeminiKey();
      const store = await createStore();
      const vector = await embedQuery(query);
      const hits = await store.search(
        vector,
        {
          rootIds: options.rootId,
          pathSubstring: options.path
        },
        Math.max(1, Math.min(options.limit ?? 8, 20))
      );

      console.log(JSON.stringify(buildContextBundle(query, hits, Math.max(500, options.maxChars ?? 12000)), null, 2));
    }
  );

program
  .command("list-roots")
  .description("List indexed roots registered in local config.")
  .action(async () => {
    console.log(JSON.stringify({ roots: await listRoots() }, null, 2));
  });

program
  .command("delete-root")
  .argument("<rootId>", "Root identifier to delete")
  .description("Delete one indexed root from local config and Qdrant.")
  .action(async (rootId: string) => {
    const root = await findRoot(rootId);
    if (!root) {
      throw new OwnSearchError(`Unknown root: ${rootId}`);
    }

    const store = await createStore();
    await store.deleteRoot(root.id);
    await deleteRootDefinition(root.id);
    console.log(JSON.stringify({ deleted: true, root }, null, 2));
  });

program
  .command("store-status")
  .description("Show Qdrant collection status for this package.")
  .action(async () => {
    const store = await createStore();
    console.log(JSON.stringify(await store.getStatus(), null, 2));
  });

program
  .command("doctor")
  .description("Check local prerequisites and package configuration.")
  .action(async () => {
    const config = await loadConfig();
    const roots = await listRoots();
    let qdrantReachable = false;

    try {
      const store = await createStore();
      await store.getStatus();
      qdrantReachable = true;
    } catch (error) {
      qdrantReachable = false;
    }

    console.log(JSON.stringify({
      configPath: getConfigPath(),
      envPath: getEnvPath(),
      geminiApiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      qdrantUrl: config.qdrantUrl,
      qdrantReachable,
      collection: config.qdrantCollection,
      embeddingModel: config.embeddingModel,
      vectorSize: config.vectorSize,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      maxFileBytes: config.maxFileBytes,
      rootCount: roots.length
    }, null, 2));
  });

program
  .command("serve-mcp")
  .description("Start the stdio MCP server.")
  .action(async () => {
    const currentFilePath = fileURLToPath(import.meta.url);
    const serverPath = path.join(path.dirname(currentFilePath), "mcp", "server.js");
    const child = spawn(process.execPath, [serverPath], {
      stdio: "inherit",
      env: process.env
    });

    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
    });
  });

program
  .command("print-agent-config")
  .argument("<agent>", "codex | claude-desktop | cursor")
  .description("Print an MCP config snippet for a supported agent.")
  .action(async (agent: string) => {
    const config = {
      command: "npx",
      args: ["-y", PACKAGE_NAME, "serve-mcp"],
      env: {
        GEMINI_API_KEY: "${GEMINI_API_KEY}"
      }
    };

    switch (agent) {
      case "codex":
      case "claude-desktop":
      case "cursor":
        console.log(JSON.stringify({ ownsearch: config }, null, 2));
        return;
      default:
        throw new OwnSearchError(`Unsupported agent: ${agent}`);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

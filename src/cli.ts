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
  getCwdEnvPath,
  findRoot,
  getConfigPath,
  getEnvPath,
  listRoots,
  loadConfig,
  loadOwnSearchEnv,
  readEnvFile,
  saveGeminiApiKey
} from "./config.js";
import { OwnSearchError } from "./errors.js";
import { embedQuery } from "./gemini.js";
import { indexPath } from "./indexer.js";
import { createStore } from "./qdrant.js";

loadOwnSearchEnv();

const program = new Command();
const PACKAGE_NAME = "ownsearch";
const GEMINI_API_KEY_URL = "https://aistudio.google.com/apikey";
const SUPPORTED_AGENTS = [
  "codex",
  "claude-desktop",
  "continue",
  "copilot-cli",
  "cursor",
  "github-copilot",
  "vscode",
  "windsurf"
] as const;
type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

interface DoctorVerdict {
  status: "ready" | "action_required";
  summary: string;
  nextSteps: string[];
}

function requireGeminiKey(): void {
  if (!process.env.GEMINI_API_KEY) {
    throw new OwnSearchError("Set GEMINI_API_KEY before running OwnSearch.");
  }
}

function buildAgentConfig(agent: SupportedAgent): Record<string, unknown> {
  const stdioConfig = {
    command: "npx",
    args: ["-y", PACKAGE_NAME, "serve-mcp"],
    env: {
      GEMINI_API_KEY: "${GEMINI_API_KEY}"
    }
  };

  switch (agent) {
    case "codex":
      return {
        platform: "codex",
        configScope: "Add this server entry to your Codex MCP configuration.",
        config: { ownsearch: stdioConfig }
      };
    case "claude-desktop":
      return {
        platform: "claude-desktop",
        installMethod: "Desktop Extension (.mcpb)",
        note: "Current Claude Desktop documentation recommends local MCP installation through Desktop Extensions instead of manual JSON config files.",
        nextStep: "OwnSearch does not yet ship an .mcpb bundle. Use Cursor, VS Code, Windsurf, Continue, or GitHub Copilot with the snippets below for now."
      };
    case "continue":
      return {
        platform: "continue",
        configPath: ".continue/mcpServers/ownsearch.json",
        note: "Continue can ingest JSON MCP configs directly.",
        config: { ownsearch: stdioConfig }
      };
    case "copilot-cli":
      return {
        platform: "copilot-cli",
        configPath: "~/.copilot/mcp-config.json",
        config: {
          mcpServers: {
            ownsearch: {
              type: "local",
              command: stdioConfig.command,
              args: stdioConfig.args,
              env: stdioConfig.env,
              tools: ["*"]
            }
          }
        }
      };
    case "cursor":
      return {
        platform: "cursor",
        configPath: "~/.cursor/mcp.json or .cursor/mcp.json",
        config: { ownsearch: stdioConfig }
      };
    case "github-copilot":
    case "vscode":
      return {
        platform: agent,
        configPath: ".vscode/mcp.json or VS Code user profile mcp.json",
        config: {
          servers: {
            ownsearch: stdioConfig
          }
        }
      };
    case "windsurf":
      return {
        platform: "windsurf",
        configPath: "~/.codeium/mcp_config.json",
        config: {
          mcpServers: {
            ownsearch: stdioConfig
          }
        }
      };
    default:
      throw new OwnSearchError(`Unsupported agent: ${agent}`);
  }
}

function getDoctorVerdict(input: { geminiApiKeyPresent: boolean; qdrantReachable: boolean; rootCount: number }): DoctorVerdict {
  const nextSteps: string[] = [];

  if (!input.geminiApiKeyPresent) {
    nextSteps.push("Run `ownsearch setup` and save a Gemini API key.");
  }

  if (!input.qdrantReachable) {
    nextSteps.push("Run `ownsearch setup` to start or reconnect to the local Qdrant container.");
  }

  if (input.geminiApiKeyPresent && input.qdrantReachable && input.rootCount === 0) {
    nextSteps.push("Run `ownsearch index C:\\path\\to\\folder --name my-folder` to add your first indexed root.");
  }

  if (nextSteps.length === 0) {
    nextSteps.push("Run `ownsearch index C:\\path\\to\\folder --name my-folder` to add more content, or `ownsearch serve-mcp` to connect an agent.");
    return {
      status: "ready",
      summary: input.rootCount > 0
        ? "OwnSearch is ready for indexing, search, and MCP agent use."
        : "OwnSearch is ready. Qdrant and Gemini are configured.",
      nextSteps
    };
  }

  return {
    status: "action_required",
    summary: "OwnSearch is not fully ready yet.",
    nextSteps
  };
}

async function promptForGeminiKey(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log(`Generate a Gemini API key here: ${GEMINI_API_KEY_URL}`);
    console.log(`OwnSearch will save it to ${getEnvPath()}`);

    for (;;) {
      const apiKey = (await rl.question("Paste GEMINI_API_KEY and press Enter (Ctrl+C to cancel): ")).trim();
      if (!apiKey) {
        console.log("GEMINI_API_KEY is required for indexing and search.");
        continue;
      }

      await saveGeminiApiKey(apiKey);
      process.env.GEMINI_API_KEY = apiKey;
      return true;
    }
  } finally {
    rl.close();
  }
}

function getGeminiApiKeySource(): "ownsearch-env" | "cwd-env" | "process-env" | "missing" {
  if (readEnvFile(getEnvPath()).GEMINI_API_KEY) {
    return "ownsearch-env";
  }

  if (readEnvFile(getCwdEnvPath()).GEMINI_API_KEY) {
    return "cwd-env";
  }

  if (process.env.GEMINI_API_KEY) {
    return "process-env";
  }

  return "missing";
}

async function ensureManagedGeminiKey(): Promise<{ present: boolean; source: string; savedToManagedEnv: boolean }> {
  const source = getGeminiApiKeySource();

  if (source === "ownsearch-env") {
    return { present: true, source, savedToManagedEnv: false };
  }

  if (process.env.GEMINI_API_KEY) {
    await saveGeminiApiKey(process.env.GEMINI_API_KEY);
    return { present: true, source, savedToManagedEnv: true };
  }

  const prompted = await promptForGeminiKey();
  return {
    present: prompted,
    source: prompted ? "prompt" : "missing",
    savedToManagedEnv: prompted
  };
}

function printSetupNextSteps(): void {
  console.log("");
  console.log("Next commands:");
  console.log("  CLI indexing:");
  console.log("    ownsearch index C:\\path\\to\\folder --name my-folder");
  console.log("  CLI search:");
  console.log("    ownsearch search \"your question here\" --limit 5");
  console.log("  CLI grounded context:");
  console.log("    ownsearch search-context \"your question here\" --limit 8 --max-chars 12000");
  console.log("  MCP server for agents:");
  console.log("    ownsearch serve-mcp");
  console.log("  Agent config snippets:");
  console.log("    ownsearch print-agent-config codex");
  console.log("    ownsearch print-agent-config claude-desktop");
  console.log("    ownsearch print-agent-config cursor");
  console.log("    ownsearch print-agent-config vscode");
  console.log("    ownsearch print-agent-config github-copilot");
  console.log("    ownsearch print-agent-config copilot-cli");
  console.log("    ownsearch print-agent-config windsurf");
  console.log("    ownsearch print-agent-config continue");
}

async function promptForAgentChoice(): Promise<SupportedAgent | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("");
    console.log("Connect to an agent now?");
    console.log("  1. codex");
    console.log("  2. claude-desktop");
    console.log("  3. cursor");
    console.log("  4. vscode");
    console.log("  5. windsurf");
    console.log("  6. copilot-cli");
    console.log("  7. continue");
    console.log("  8. skip");

    for (;;) {
      const answer = (await rl.question("Select 1-8: ")).trim().toLowerCase();

      switch (answer) {
        case "1":
        case "codex":
          return "codex";
        case "2":
        case "claude-desktop":
        case "claude":
          return "claude-desktop";
        case "3":
        case "cursor":
          return "cursor";
        case "4":
        case "vscode":
        case "github-copilot":
          return "vscode";
        case "5":
        case "windsurf":
          return "windsurf";
        case "6":
        case "copilot-cli":
        case "copilot":
          return "copilot-cli";
        case "7":
        case "continue":
          return "continue";
        case "8":
        case "skip":
        case "":
          return undefined;
        default:
          console.log("Enter 1, 2, 3, 4, 5, 6, 7, or 8.");
      }
    }
  } finally {
    rl.close();
  }
}

function printAgentConfigSnippet(agent: SupportedAgent): void {
  console.log("");
  console.log(`MCP config for ${agent}:`);
  console.log(JSON.stringify(buildAgentConfig(agent), null, 2));
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
    const gemini = await ensureManagedGeminiKey();
    console.log(JSON.stringify({
      configPath: getConfigPath(),
      envPath: getEnvPath(),
      qdrantUrl: config.qdrantUrl,
      qdrantStarted: result.started,
      geminiApiKeyPresent: gemini.present,
      geminiApiKeySource: gemini.source,
      geminiApiKeySavedToManagedEnv: gemini.savedToManagedEnv
    }, null, 2));
    if (!gemini.present) {
      console.log(`GEMINI_API_KEY is not set. Re-run setup or add it to ${getEnvPath()} before indexing or search.`);
      return;
    }

    printSetupNextSteps();
    const agent = await promptForAgentChoice();
    if (agent) {
      printAgentConfigSnippet(agent);
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

    const verdict = getDoctorVerdict({
      geminiApiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      qdrantReachable,
      rootCount: roots.length
    });

    console.log(JSON.stringify({
      verdict,
      configPath: getConfigPath(),
      envPath: getEnvPath(),
      geminiApiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      geminiApiKeySource: getGeminiApiKeySource(),
      qdrantUrl: config.qdrantUrl,
      qdrantReachable,
      collection: config.qdrantCollection,
      embeddingModel: config.embeddingModel,
      vectorSize: config.vectorSize,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      maxExtractedDocumentBytes: config.maxFileBytes,
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
  .argument("<agent>", SUPPORTED_AGENTS.join(" | "))
  .description("Print an MCP config snippet for a supported agent.")
  .action(async (agent: string) => {
    if (SUPPORTED_AGENTS.includes(agent as SupportedAgent)) {
      console.log(JSON.stringify(buildAgentConfig(agent as SupportedAgent), null, 2));
      return;
    }

    throw new OwnSearchError(`Unsupported agent: ${agent}`);
  });

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

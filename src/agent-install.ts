import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import TOML from "@iarna/toml";
import { OwnSearchError } from "./errors.js";

const execFile = promisify(execFileCallback);

export type InstallableAgent =
  | "codex"
  | "continue"
  | "copilot-cli"
  | "cursor"
  | "github-copilot"
  | "vscode"
  | "windsurf";

export interface AgentInstallResult {
  agent: InstallableAgent;
  method: "file-merge" | "cli";
  targetPath?: string;
  command?: string;
  summary: string;
}

const OWNSEARCH_STDIO_CONFIG = {
  command: "ownsearch",
  args: ["serve-mcp"]
};

function getJsonServerConfig() {
  return {
    command: OWNSEARCH_STDIO_CONFIG.command,
    args: OWNSEARCH_STDIO_CONFIG.args
  };
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function mergeJsonServerFile(filePath: string, topLevelKey: string): Promise<AgentInstallResult> {
  const parsed = await readJsonFile(filePath);
  const next = { ...parsed };
  const existingServers = isRecord(next[topLevelKey]) ? { ...(next[topLevelKey] as Record<string, unknown>) } : {};
  existingServers.ownsearch = getJsonServerConfig();
  next[topLevelKey] = existingServers;
  await writeJsonFile(filePath, next);

  return {
    agent: "cursor",
    method: "file-merge",
    targetPath: filePath,
    summary: `Updated ${filePath} and merged OwnSearch into ${topLevelKey}.`
  };
}

async function installCodexConfig(): Promise<AgentInstallResult> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  await ensureDir(path.dirname(configPath));

  let parsed: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const mcpServers = isRecord(parsed.mcp_servers) ? { ...(parsed.mcp_servers as Record<string, unknown>) } : {};
  mcpServers.ownsearch = {
    command: OWNSEARCH_STDIO_CONFIG.command,
    args: OWNSEARCH_STDIO_CONFIG.args
  };
  parsed.mcp_servers = mcpServers;

  await fs.writeFile(configPath, TOML.stringify(parsed as never), "utf8");

  return {
    agent: "codex",
    method: "file-merge",
    targetPath: configPath,
    summary: `Updated ${configPath} and merged OwnSearch into [mcp_servers].`
  };
}

async function installVsCodeConfig(agent: "vscode" | "github-copilot"): Promise<AgentInstallResult> {
  const payload = JSON.stringify({
    name: "ownsearch",
    command: OWNSEARCH_STDIO_CONFIG.command,
    args: OWNSEARCH_STDIO_CONFIG.args
  });

  const commands = process.platform === "win32" ? ["code.cmd", "code"] : ["code"];
  let lastError: unknown;

  for (const command of commands) {
    try {
      await execFile(command, ["--add-mcp", payload], {
        windowsHide: true
      });
      return {
        agent,
        method: "cli",
        command,
        summary: `Added OwnSearch to VS Code via \`${command} --add-mcp\`.`
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new OwnSearchError(
    "Could not add OwnSearch to VS Code automatically because the `code` CLI was not found. Install the VS Code shell command or use `ownsearch print-agent-config vscode`."
  );
}

async function installContinueConfig(): Promise<AgentInstallResult> {
  const filePath = path.join(os.homedir(), ".continue", "mcpServers", "ownsearch.json");
  await writeJsonFile(filePath, {
    mcpServers: {
      ownsearch: getJsonServerConfig()
    }
  });

  return {
    agent: "continue",
    method: "file-merge",
    targetPath: filePath,
    summary: `Wrote Continue MCP config to ${filePath}.`
  };
}

export async function installAgentConfig(agent: InstallableAgent): Promise<AgentInstallResult> {
  switch (agent) {
    case "codex":
      return installCodexConfig();
    case "vscode":
    case "github-copilot":
      return installVsCodeConfig(agent);
    case "cursor": {
      const result = await mergeJsonServerFile(path.join(os.homedir(), ".cursor", "mcp.json"), "mcpServers");
      return { ...result, agent: "cursor" };
    }
    case "windsurf": {
      const result = await mergeJsonServerFile(path.join(os.homedir(), ".codeium", "mcp_config.json"), "mcpServers");
      return { ...result, agent: "windsurf" };
    }
    case "copilot-cli": {
      const result = await mergeJsonServerFile(path.join(os.homedir(), ".copilot", "mcp-config.json"), "mcpServers");
      return { ...result, agent: "copilot-cli" };
    }
    case "continue":
      return installContinueConfig();
    default:
      throw new OwnSearchError(`Automatic MCP installation is not supported for ${agent}.`);
  }
}

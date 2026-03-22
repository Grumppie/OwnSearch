import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_COLLECTION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_QDRANT_CONTAINER,
  DEFAULT_QDRANT_URL,
  DEFAULT_QDRANT_VOLUME,
  DEFAULT_VECTOR_SIZE
} from "./constants.js";
import type { OwnSearchConfig, RootDefinition } from "./types.js";
import { slugifyName } from "./utils.js";

function defaultConfig(): OwnSearchConfig {
  return {
    qdrantUrl: DEFAULT_QDRANT_URL,
    qdrantCollection: DEFAULT_COLLECTION,
    qdrantContainerName: DEFAULT_QDRANT_CONTAINER,
    qdrantVolumeName: DEFAULT_QDRANT_VOLUME,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    vectorSize: DEFAULT_VECTOR_SIZE,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    roots: []
  };
}

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function getEnvPath(): string {
  return path.join(getConfigDir(), ".env");
}

export function getCwdEnvPath(): string {
  return path.resolve(process.cwd(), ".env");
}

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
}

export function loadOwnSearchEnv(): void {
  for (const envPath of [getCwdEnvPath(), getEnvPath()]) {
    if (!fsSync.existsSync(envPath)) {
      continue;
    }

    const parsed = dotenv.parse(fsSync.readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function readEnvFile(envPath: string): Record<string, string> {
  if (!fsSync.existsSync(envPath)) {
    return {};
  }

  return dotenv.parse(fsSync.readFileSync(envPath, "utf8"));
}

export async function loadConfig(): Promise<OwnSearchConfig> {
  await ensureConfigDir();
  const configPath = getConfigPath();

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as OwnSearchConfig;
    const config = {
      ...defaultConfig(),
      ...parsed,
      maxFileBytes: Math.max(parsed.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
      roots: parsed.roots ?? []
    };
    if (config.maxFileBytes !== parsed.maxFileBytes) {
      await saveConfig(config);
    }
    return config;
  } catch (error) {
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: OwnSearchConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(getEnvPath(), `GEMINI_API_KEY=${apiKey.trim()}\n`, "utf8");
}

export function createRootDefinition(rootPath: string, name?: string): RootDefinition {
  const now = new Date().toISOString();
  const rootName = name?.trim() || path.basename(rootPath);
  return {
    id: slugifyName(`${rootName}-${rootPath}`),
    name: rootName,
    path: path.resolve(rootPath),
    createdAt: now,
    updatedAt: now
  };
}

export async function upsertRoot(rootPath: string, name?: string): Promise<RootDefinition> {
  const config = await loadConfig();
  const absolutePath = path.resolve(rootPath);
  const existing = config.roots.find((root) => root.path === absolutePath);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name?.trim() || existing.name;
    existing.updatedAt = now;
    await saveConfig(config);
    return existing;
  }

  const root = createRootDefinition(absolutePath, name);
  config.roots.push(root);
  await saveConfig(config);
  return root;
}

export async function deleteRootDefinition(rootId: string): Promise<boolean> {
  const config = await loadConfig();
  const initialLength = config.roots.length;
  config.roots = config.roots.filter((root) => root.id !== rootId);
  await saveConfig(config);
  return config.roots.length !== initialLength;
}

export async function findRoot(rootId: string): Promise<RootDefinition | undefined> {
  const config = await loadConfig();
  return config.roots.find((root) => root.id === rootId);
}

export async function listRoots(): Promise<RootDefinition[]> {
  const config = await loadConfig();
  return config.roots;
}

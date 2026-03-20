import fs from "node:fs/promises";
import path from "node:path";
import { chunkText } from "./chunking.js";
import { loadConfig, upsertRoot } from "./config.js";
import { OwnSearchError } from "./errors.js";
import { collectTextFiles } from "./files.js";
import { embedDocuments } from "./gemini.js";
import { createStore } from "./qdrant.js";
import type { ChunkRecord, RootDefinition } from "./types.js";
import { hashToUuid, sha256, toPosixPath } from "./utils.js";

export interface IndexResult {
  root: RootDefinition;
  indexedFiles: number;
  indexedChunks: number;
  skippedFiles: number;
}

export interface IndexOptions {
  name?: string;
  maxFileBytes?: number;
}

function buildChunkId(rootId: string, relativePath: string, chunkIndex: number, fileHash: string): string {
  return hashToUuid(`${rootId}:${relativePath}:${chunkIndex}:${fileHash}`);
}

async function embedRecords(records: ChunkRecord[]): Promise<{ records: ChunkRecord[]; vectors: number[][]; skipped: number }> {
  if (records.length === 0) {
    return { records: [], vectors: [], skipped: 0 };
  }

  try {
    const vectors = await embedDocuments(records.map((record) => record.content));
    return { records, vectors, skipped: 0 };
  } catch (error) {
    if (records.length === 1) {
      const debug = process.env.OWNSEARCH_DEBUG_INDEX === "1";
      if (debug) {
        console.log("[ownsearch:embed]", "skip-chunk", records[0].relativePath, String(error));
      }
      return { records: [], vectors: [], skipped: 1 };
    }

    const midpoint = Math.floor(records.length / 2);
    const left = await embedRecords(records.slice(0, midpoint));
    const right = await embedRecords(records.slice(midpoint));
    return {
      records: [...left.records, ...right.records],
      vectors: [...left.vectors, ...right.vectors],
      skipped: left.skipped + right.skipped
    };
  }
}

export async function indexPath(rootPath: string, options: IndexOptions = {}): Promise<IndexResult> {
  const absolutePath = path.resolve(rootPath);
  const stats = await fs.stat(absolutePath).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new OwnSearchError(`Path is not a readable directory: ${absolutePath}`);
  }

  const config = await loadConfig();
  const root = await upsertRoot(absolutePath, options.name);
  const store = await createStore();
  const files = await collectTextFiles(root.path, options.maxFileBytes ?? config.maxFileBytes);
  const existingChunks = await store.scrollRootChunks(root.id);
  const records: ChunkRecord[] = [];
  const filesByPath = new Map<string, typeof files[number]>();
  const existingByPath = new Map<string, ChunkRecord[]>();
  const refreshAllMetadata = existingChunks.some(
    (chunk) => chunk.rootName !== root.name || chunk.rootPath !== root.path
  );

  for (const file of files) {
    filesByPath.set(file.path, file);
  }

  for (const chunk of existingChunks) {
    const list = existingByPath.get(chunk.filePath) ?? [];
    list.push(chunk);
    existingByPath.set(chunk.filePath, list);
  }

  const staleFiles: string[] = [];

  for (const file of files) {
    const fileHash = sha256(file.content);
    const chunks = chunkText(file.content, config.chunkSize, config.chunkOverlap);
    const existing = existingByPath.get(file.path);
    const existingFileHash = existing?.[0]?.fileHash;
    const existingChunkCount = existing?.length ?? 0;

    if (!refreshAllMetadata && existing && existingFileHash === fileHash && existingChunkCount === chunks.length) {
      continue;
    }

    if (existing?.length) {
      staleFiles.push(file.path);
    }

    chunks.forEach((content, chunkIndex) => {
      records.push({
        id: buildChunkId(root.id, toPosixPath(file.relativePath), chunkIndex, fileHash),
        rootId: root.id,
        rootPath: root.path,
        rootName: root.name,
        filePath: file.path,
        relativePath: toPosixPath(file.relativePath),
        fileExtension: file.extension,
        chunkIndex,
        content,
        contentHash: sha256(content),
        fileHash,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes
      });
    });
  }

  for (const [existingFilePath] of existingByPath.entries()) {
    if (!filesByPath.has(existingFilePath)) {
      staleFiles.push(existingFilePath);
    }
  }

  if (staleFiles.length > 0) {
    await store.deleteFiles(root.id, Array.from(new Set(staleFiles)));
  }

  if (records.length === 0) {
    return {
      root,
      indexedFiles: files.length,
      indexedChunks: 0,
      skippedFiles: 0
    };
  }

  const embedded = await embedRecords(records);
  if (embedded.records.length > 0) {
    await store.upsertChunks(embedded.records, embedded.vectors);
  }

  return {
    root,
    indexedFiles: files.length,
    indexedChunks: embedded.records.length,
    skippedFiles: 0
  };
}

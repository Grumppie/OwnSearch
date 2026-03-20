import { QdrantClient } from "@qdrant/js-client-rest";
import { loadConfig } from "./config.js";
import type { ChunkLookupResult, ChunkRecord, SearchFilters } from "./types.js";

interface SearchResult {
  id: string | number;
  score: number;
  payload: Record<string, unknown> | null | undefined;
}

interface StoredPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
}

export interface SearchHit {
  id: string;
  score: number;
  rootId: string;
  rootName: string;
  filePath?: string;
  relativePath: string;
  chunkIndex: number;
  content: string;
}

export class OwnSearchStore {
  constructor(
    private readonly client: QdrantClient,
    private readonly collectionName: string,
    private readonly vectorSize: number
  ) {}

  async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((collection) => collection.name === this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine"
        }
      });
    } else {
      const info = await this.client.getCollection(this.collectionName);
      const vectorConfig = info.config?.params?.vectors;
      const actualSize =
        vectorConfig && !Array.isArray(vectorConfig) && "size" in vectorConfig
          ? Number(vectorConfig.size)
          : undefined;

      if (actualSize && actualSize !== this.vectorSize) {
        throw new Error(
          `Qdrant collection ${this.collectionName} has vector size ${actualSize}, expected ${this.vectorSize}.`
        );
      }
    }

    await Promise.allSettled([
      this.client.createPayloadIndex(this.collectionName, {
        field_name: "root_id",
        field_schema: "keyword"
      }),
      this.client.createPayloadIndex(this.collectionName, {
        field_name: "relative_path",
        field_schema: "keyword"
      })
    ]);
  }

  async upsertChunks(records: ChunkRecord[], vectors: number[][]): Promise<void> {
    const batchSize = 50;
    for (let index = 0; index < records.length; index += batchSize) {
      const batchRecords = records.slice(index, index + batchSize);
      const batchVectors = vectors.slice(index, index + batchSize);
      const points = batchRecords.map((record, batchIndex) => ({
        id: record.id,
        vector: batchVectors[batchIndex],
        payload: {
          root_id: record.rootId,
          root_name: record.rootName,
          root_path: record.rootPath,
          file_path: record.filePath,
          relative_path: record.relativePath,
          file_extension: record.fileExtension,
          chunk_index: record.chunkIndex,
          content: record.content,
          content_hash: record.contentHash,
          file_hash: record.fileHash,
          mtime_ms: record.mtimeMs,
          size_bytes: record.sizeBytes
        }
      }));

      await this.client.upsert(this.collectionName, {
        wait: true,
        points
      });
    }
  }

  async scrollRootChunks(rootId: string): Promise<ChunkRecord[]> {
    const chunks: ChunkRecord[] = [];
    let offset: string | number | undefined;

    do {
      const result = await this.client.scroll(this.collectionName, {
        limit: 1024,
        offset,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [
            {
              key: "root_id",
              match: {
                value: rootId
              }
            }
          ]
        }
      });

      chunks.push(
        ...((result.points ?? []) as StoredPoint[]).map((point) => ({
          id: String(point.id),
          rootId: String(point.payload?.root_id ?? ""),
          rootPath: String(point.payload?.root_path ?? ""),
          rootName: String(point.payload?.root_name ?? ""),
          filePath: String(point.payload?.file_path ?? ""),
          relativePath: String(point.payload?.relative_path ?? ""),
          fileExtension: String(point.payload?.file_extension ?? ""),
          chunkIndex: Number(point.payload?.chunk_index ?? 0),
          content: String(point.payload?.content ?? ""),
          contentHash: String(point.payload?.content_hash ?? ""),
          fileHash: String(point.payload?.file_hash ?? ""),
          mtimeMs: Number(point.payload?.mtime_ms ?? 0),
          sizeBytes: Number(point.payload?.size_bytes ?? 0)
        }))
      );

      offset = result.next_page_offset as string | number | undefined;
    } while (offset !== undefined && offset !== null);

    return chunks;
  }

  async deleteRoot(rootId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: "root_id",
            match: {
              value: rootId
            }
          }
        ]
      }
    });
  }

  async deleteFiles(rootId: string, filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: "root_id",
              match: {
                value: rootId
              }
            },
            {
              key: "file_path",
              match: {
                value: filePath
              }
            }
          ]
        }
      });
    }
  }

  async search(vector: number[], filters: SearchFilters, limit: number): Promise<SearchHit[]> {
    const must: Array<Record<string, unknown>> = [];

    if (filters.rootIds?.length) {
      must.push({
        key: "root_id",
        match: {
          any: filters.rootIds
        }
      });
    }

    const results = await this.client.search(this.collectionName, {
      vector,
      limit: filters.pathSubstring ? Math.max(limit * 3, limit) : limit,
      with_payload: true,
      filter: must.length ? { must } : undefined
    });

    const hits = (results as SearchResult[]).map((result) => ({
      id: String(result.id),
      score: result.score,
      rootId: String(result.payload?.root_id ?? ""),
      rootName: String(result.payload?.root_name ?? ""),
      filePath: String(result.payload?.file_path ?? ""),
      relativePath: String(result.payload?.relative_path ?? ""),
      chunkIndex: Number(result.payload?.chunk_index ?? 0),
      content: String(result.payload?.content ?? "")
    }));

    if (!filters.pathSubstring) {
      return hits.slice(0, limit);
    }

    const needle = filters.pathSubstring.toLowerCase();
    return hits.filter((hit) => hit.relativePath.toLowerCase().includes(needle)).slice(0, limit);
  }

  async getChunks(ids: string[]): Promise<ChunkLookupResult[]> {
    if (ids.length === 0) {
      return [];
    }

    const points = await this.client.retrieve(this.collectionName, {
      ids,
      with_payload: true,
      with_vector: false
    });

    return ((points ?? []) as StoredPoint[]).map((point) => ({
      id: String(point.id),
      rootId: String(point.payload?.root_id ?? ""),
      rootName: String(point.payload?.root_name ?? ""),
      filePath: String(point.payload?.file_path ?? ""),
      relativePath: String(point.payload?.relative_path ?? ""),
      chunkIndex: Number(point.payload?.chunk_index ?? 0),
      content: String(point.payload?.content ?? "")
    }));
  }

  async getStatus(): Promise<Record<string, unknown>> {
    const info = await this.client.getCollection(this.collectionName);
    return {
      collection: this.collectionName,
      status: info.status,
      pointsCount: info.points_count,
      indexedVectorsCount: info.indexed_vectors_count,
      vectorConfig: info.config?.params?.vectors ?? null
    };
  }
}

export async function createStore(): Promise<OwnSearchStore> {
  const config = await loadConfig();
  const client = new QdrantClient({ url: config.qdrantUrl, checkCompatibility: false });
  const store = new OwnSearchStore(client, config.qdrantCollection, config.vectorSize);
  await store.ensureCollection();
  return store;
}

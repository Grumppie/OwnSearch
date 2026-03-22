export interface RootDefinition {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnSearchConfig {
  qdrantUrl: string;
  qdrantCollection: string;
  qdrantContainerName: string;
  qdrantVolumeName: string;
  embeddingModel: string;
  vectorSize: number;
  chunkSize: number;
  chunkOverlap: number;
  maxFileBytes: number;
  roots: RootDefinition[];
}

export interface ChunkRecord {
  id: string;
  rootId: string;
  rootPath: string;
  rootName: string;
  filePath: string;
  relativePath: string;
  fileExtension: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  fileHash: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface SearchFilters {
  queryText?: string;
  rootIds?: string[];
  pathSubstring?: string;
}

export interface ChunkLookupResult {
  id: string;
  rootId: string;
  rootName: string;
  filePath: string;
  relativePath: string;
  chunkIndex: number;
  content: string;
}

export interface ContextBundleItem {
  id: string;
  score: number;
  rootId: string;
  rootName: string;
  relativePath: string;
  chunkIndex: number;
  content: string;
}

export interface ContextBundle {
  query: string;
  totalChars: number;
  results: ContextBundleItem[];
}

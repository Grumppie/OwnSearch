export const CONFIG_DIR_NAME = ".ownsearch";
export const CONFIG_FILE_NAME = "config.json";
export const DEFAULT_COLLECTION = "text_gemini_embedding_001_768";
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
export const DEFAULT_VECTOR_SIZE = 768;
export const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333";
export const DEFAULT_QDRANT_CONTAINER = "ownsearch-qdrant";
export const DEFAULT_QDRANT_VOLUME = "ownsearch-qdrant-storage";
export const DEFAULT_CHUNK_SIZE = 1200;
export const DEFAULT_CHUNK_OVERLAP = 200;
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".pdf",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".idea",
  ".next",
  ".svn",
  ".turbo",
  ".venv",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv"
]);

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
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".docx",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".pdf",
  ".ps1",
  ".properties",
  ".py",
  ".rb",
  ".rtf",
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
export const EXTRACTED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".rtf"
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

export const DOWNWEIGHTED_PATH_SUBSTRINGS = [
  "/09_benchmark_queries.txt",
  "/10_extra_hard_notes_for_chunking.txt",
  "09_benchmark_queries.txt",
  "10_extra_hard_notes_for_chunking.txt"
];

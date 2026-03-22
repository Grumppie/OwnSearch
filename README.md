# ownsearch

**ownsearch** is a local search layer for agents.

It indexes approved folders into a local Qdrant vector store, exposes retrieval through an MCP server, and gives agents grounded access to private knowledge without requiring a hosted search service.

V1 is intentionally text-first: reliable local retrieval for documentation, code, and extracted PDF text. Future versions are intended to expand into multimodal indexing and search for images, audio, video, and richer document workflows.

## What it does

- Indexes local folders into a persistent vector store
- Chunks and embeds supported files with Gemini
- Supports incremental reindexing for changed and deleted files
- Exposes search and context retrieval through MCP
- Lets agents retrieve ranked hits, exact chunks, or bundled grounded context

## V1 scope

- text and code files
- extracted text from PDFs
- Gemini `gemini-embedding-001`
- Docker-backed Qdrant
- stdio MCP server for local agent attachment

## Quickstart

Install `ownsearch` globally:

```bash
npm install -g ownsearch
```

Set it up, index a folder, and start searching:

```bash
ownsearch setup
ownsearch doctor
ownsearch index ./docs --name docs
ownsearch list-roots
ownsearch search "what is this repo about?" --limit 5
ownsearch search-context "what is this repo about?" --limit 8 --max-chars 12000
ownsearch serve-mcp
```

On first run, `ownsearch setup` can prompt for `GEMINI_API_KEY` and save it to `~/.ownsearch/.env`, which is then reused automatically by later CLI and MCP runs.

To connect `ownsearch` to a supported agent, print a config snippet for your client:

```bash
ownsearch print-agent-config codex
ownsearch print-agent-config claude-desktop
ownsearch print-agent-config cursor
```

## Local development

If you want to run `ownsearch` from source while developing locally:

```bash
npm install
npm run build
node dist/cli.js setup
node dist/cli.js index ./docs --name docs
node dist/cli.js search "what is this repo about?" --limit 5
node dist/cli.js serve-mcp
```

## CLI commands

- `ownsearch setup`
  Starts or reconnects to the local Qdrant Docker container, creates local config, and can save `GEMINI_API_KEY` into `~/.ownsearch/.env`.
- `ownsearch doctor`
  Checks config, Gemini key presence, Qdrant connectivity, and active collection settings.
- `ownsearch index <folder> --name <name>`
  Indexes a folder incrementally into the local vector collection.
- `ownsearch list-roots`
  Lists approved indexed roots.
- `ownsearch search "<query>"`
  Returns ranked search hits from the vector store.
- `ownsearch search-context "<query>"`
  Returns a compact grounded context bundle for agents.
- `ownsearch delete-root <rootId>`
  Removes a root from config and deletes its vectors from Qdrant.
- `ownsearch store-status`
  Shows collection status and vector configuration.
- `ownsearch serve-mcp`
  Starts the stdio MCP server.
- `ownsearch print-agent-config <agent>`
  Prints an MCP config snippet for supported agents.

## MCP tools

The MCP server currently exposes:

- `index_path`
- `search`
- `search_context`
- `get_chunks`
- `list_roots`
- `delete_root`
- `store_status`

Recommended agent flow:

1. Call `search_context` for fast grounded retrieval.
2. If more precision is needed, call `search`.
3. Use `get_chunks` on selected hit IDs for exact source text.

## Notes

- Config is stored in `~/.ownsearch/config.json`
- Shared CLI and MCP secrets can be stored in `~/.ownsearch/.env`
- Qdrant runs locally in Docker as `ownsearch-qdrant`
- `GEMINI_API_KEY` may come from the shell environment, the current working directory `.env`, or `~/.ownsearch/.env`
- Node.js `20+` is required

## Roadmap

Planned after the text-first v1:

- richer document extraction
- better reranking and deduplication
- watch mode for automatic reindexing
- HTTP MCP transport
- multimodal indexing and search for:
  - images
  - audio
  - video
  - richer document formats

The multimodal phase will require careful collection migration because Gemini text and multimodal embedding spaces are not interchangeable across model families.

## License

MIT

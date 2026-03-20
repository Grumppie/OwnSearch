# ownsearch

**ownsearch** is a local search layer for agents.

It indexes approved folders into a local Qdrant store, exposes retrieval through an MCP server, and lets your agents search private knowledge without a hosted search service.

V1 is intentionally text-first: simple, reliable local retrieval for docs, code, and PDFs. Over time, **ownsearch** will expand to support multimodal files and data, including images, audio, video, and richer cross-modal search workflows.

## What it does

- Indexes local folders into a persistent vector store
- Chunks and embeds supported files with Gemini
- Supports incremental reindexing for changed and deleted files
- Exposes search and context retrieval through MCP
- Lets agents retrieve ranked hits, exact chunks, or grounded context bundles

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

Set it up, index a folder, and start searching:

ownsearch setup
ownsearch doctor
ownsearch index ./docs --name docs
ownsearch list-roots
ownsearch search "what is this repo about?" --limit 5
ownsearch search-context "what is this repo about?" --limit 8 --max-chars 12000
ownsearch serve-mcp

To connect ownsearch to a supported agent, print a config snippet for your client:

ownsearch print-agent-config codex
ownsearch print-agent-config claude-desktop
ownsearch print-agent-config cursor
Local development

If you want to run ownsearch from source while developing locally:

npm install
npm run build
node dist/cli.js setup
node dist/cli.js index ./docs --name docs
node dist/cli.js search "what is this repo about?" --limit 5
node dist/cli.js serve-mcp

## MCP tools

* `index_path`
* `search`
* `search_context`
* `get_chunks`
* `list_roots`
* `delete_root`
* `store_status`

## Notes

* Config is stored in `~/.ownsearch/config.json`
* Qdrant runs locally in Docker as `ownsearch-qdrant`
* `GEMINI_API_KEY` must be available in the environment or `.env`

## Roadmap

Planned after the text-first v1:

* richer document extraction
* better reranking and deduplication
* watch mode for automatic reindexing
* HTTP MCP transport
* multimodal indexing for images, audio, video, and richer document formats

## License

MIT

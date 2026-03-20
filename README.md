# ownsearch

`ownsearch` is a text-first local semantic search package that indexes folders into Qdrant and exposes retrieval tools through an MCP server.

V1 scope:

- text and code files first
- extracted text from PDFs
- Gemini embeddings with `gemini-embedding-001`
- Docker-backed Qdrant storage
- stdio MCP server for agent attachment

## Install

For local development before publish:

```bash
npm install
npm run build
npm link
```

After publish, the intended install is:

```bash
npm install -g ownsearch
```

## Quickstart

```bash
ownsearch setup
ownsearch doctor
ownsearch index ./docs --name docs
ownsearch list-roots
ownsearch search "what is this repo about?" --limit 5
ownsearch search-context "what is this repo about?" --limit 8 --max-chars 12000
ownsearch serve-mcp
```

## Agent Config

Print a config snippet for your agent:

```bash
node dist/cli.js print-agent-config codex
node dist/cli.js print-agent-config claude-desktop
node dist/cli.js print-agent-config cursor
```

## MCP Tools

- `index_path`
- `search`
- `search_context`
- `get_chunks`
- `list_roots`
- `delete_root`
- `store_status`

`index_path` is incremental. Re-running it on the same folder only re-embeds changed files and removes stale chunks.

## Notes

- Roots are stored in `~/.ownsearch/config.json`.
- Qdrant runs in Docker under the container name `ownsearch-qdrant`.
- Each indexed folder is stored as payload-filtered chunks inside a single Qdrant collection.
- Agents can call `search_context` for a ready-to-use context bundle, or call `search` first and then `get_chunks` for exact chunk retrieval.

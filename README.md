# ownsearch

`ownsearch` is a local semantic search package for agents. It indexes approved folders into a Docker-backed Qdrant vector store, exposes retrieval through a stdio MCP server, and gives agents grounded access to your private documents without requiring a hosted search service.

V1 is intentionally text-first. The goal is to make local retrieval reliable, simple to install, and easy to attach to agent runtimes.

## What It Does

- Indexes local folders into a persistent Qdrant collection
- Chunks files and embeds them with Gemini text embeddings
- Supports incremental reindexing for changed and deleted files
- Exposes search and context retrieval through MCP tools
- Lets agents retrieve exact chunks or bundled grounded context

## V1 Scope

- Text and code files
- Extracted text from PDFs
- Gemini `gemini-embedding-001`
- Qdrant running in Docker
- stdio MCP server for local agent attachment

## Architecture

The package owns the retrieval pipeline end to end:

1. File discovery inside approved local roots
2. Text extraction and chunking
3. Gemini document embeddings
4. Vector storage and filtering in Qdrant
5. MCP tools for search and context retrieval

Agents do not need to talk to Qdrant directly. They attach to the `ownsearch` MCP server and call its tools.

## Installation

For local development before npm publish:

```bash
npm install
npm run build
npm link
```

After publish:

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

## CLI Commands

- `ownsearch setup`
  Starts or reconnects to the local Qdrant Docker container and creates local config.
- `ownsearch doctor`
  Checks config, Gemini key presence, Qdrant connectivity, and active collection settings.
- `ownsearch index <folder> --name <name>`
  Indexes a folder incrementally into the local collection.
- `ownsearch list-roots`
  Lists approved indexed roots.
- `ownsearch search "<query>"`
  Returns ranked search hits from the vector store.
- `ownsearch search-context "<query>"`
  Returns a compact context bundle suitable for direct agent grounding.
- `ownsearch delete-root <rootId>`
  Removes a root from config and deletes its vectors from Qdrant.
- `ownsearch store-status`
  Shows collection status and vector configuration.
- `ownsearch serve-mcp`
  Starts the stdio MCP server.
- `ownsearch print-agent-config <agent>`
  Prints a config snippet for supported agents.

## MCP Tools

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

## Configuration

Local configuration is stored in:

```text
~/.ownsearch/config.json
```

Important runtime requirements:

- `GEMINI_API_KEY` must be available in the environment or `.env`
- Docker Desktop or Docker Engine must be running
- Node.js `20+`

Qdrant is started under the container name `ownsearch-qdrant`.

## Supported Inputs

Current text-first support includes:

- `.txt`
- `.md`, `.mdx`
- `.json`, `.yaml`, `.yml`, `.toml`
- `.html`, `.xml`, `.csv`
- common source code extensions
- `.pdf` via extracted text

## Design Notes

- Each indexed folder is stored as filtered payload inside a shared Qdrant collection, not as a separate collection.
- Search uses Gemini retrieval task types for documents and queries.
- Reindexing is incremental and removes stale vectors when files disappear.
- Agents can stay grounded by using chunk-level retrieval rather than relying on unscoped generation.

## Roadmap

Planned extensions after the text-first v1:

- Richer document extraction for DOCX and additional office formats
- Better deduplication and reranking across overlapping sources
- Watch mode for automatic local reindexing
- Streamable HTTP MCP transport for hosted deployments
- Multimodal indexing with Gemini embedding models for:
  - images
  - audio
  - video
  - native document-level cross-modal search

The multimodal phase will require separate collection migration because Gemini text and multimodal embedding spaces are not interchangeable across model families.

## Publishing

The package is designed to be published as an npm CLI package with:

- executable `ownsearch`
- bundled MCP server entrypoint
- public npm metadata linked to the GitHub repository

## License

MIT

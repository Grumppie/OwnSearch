# ownsearch

`ownsearch` is a local retrieval layer for agents.

It indexes approved folders into a local Qdrant store, embeds text with Gemini, and exposes grounded retrieval through an MCP server so agents can search private documents without depending on a hosted RAG backend.

## What it is

OwnSearch is built for text-first local corpora:

- product docs
- design docs
- policy and contract folders
- repo-adjacent documentation
- research notes
- PDF and office-style text document collections

The package is designed around one practical idea: agents do better when retrieval is a first-class tool, not an improvised mix of grep, file reads, and long-context guessing.

## Why it exists

Without a retrieval layer, agents usually fail in one of two ways:

- they search too literally and miss relevant context
- they load too much context and guess from incomplete evidence

OwnSearch tries to reduce both.

It gives agents:

- indexed local retrieval instead of repeated folder scanning
- grounded context bundles instead of raw line matches
- a hybrid retrieval surface for exact, semantic, and deeper archive-style questions
- built-in MCP guidance so the agent understands how to use the tools well

## What it does

- indexes approved local folders into a persistent vector store
- extracts and chunks supported text documents
- embeds chunks with Gemini
- stores vectors and metadata in local Qdrant
- supports incremental reindexing
- exposes retrieval through an MCP server
- reranks and deduplicates hits before returning them

Incremental indexing behavior:

- unchanged files are skipped
- updated files re-index only that file’s chunks
- new files are indexed when they appear
- deleted files are removed from the index

## Retrieval model

OwnSearch is intentionally hybrid.

It does not assume embeddings should replace exact search.

- `literal_search`
  Best for exact names, titles, IDs, quoted phrases, and grep-style lookups.
- `search_context`
  Best default for grounded question answering and efficient agent retrieval.
- `deep_search_context`
  Best for archive-style, ambiguity-heavy, or multi-document questions.
- `search`
  Best when the agent wants to inspect ranking and source spread.
- `get_chunks`
  Best when exact wording matters.

## MCP-first design

OwnSearch is packaged as an MCP server first, with CLI commands for setup, indexing, and local validation.

The MCP server exposes:

- tools for indexing and retrieval
- a retrieval skill resource
- a short retrieval guide prompt
- a tool fallback for clients that do not use MCP resources or prompts well

Built-in MCP guidance:

- resource: `ownsearch://skills/retrieval`
- prompt: `ownsearch-retrieval-guide`
- tool fallback: `get_retrieval_skill`

This matters because tool schemas alone are usually not enough. Agents also need retrieval policy: when to use literal search, when to go deeper, and when to fetch exact chunks before making strong claims.

## Supported formats in v1

Text-first support currently includes:

- plain text
- code files
- Markdown and MDX
- JSON, YAML, TOML, CSV, XML, HTML
- PDF
- DOCX
- RTF

## Setup

Requirements:

- Node.js `20+`
- Docker
- a Gemini API key

Install:

```bash
npm install -g ownsearch
```

First-run setup:

```bash
ownsearch setup
```

Setup can:

- create local config
- start or reconnect to local Qdrant in Docker
- guide the user through Gemini API key setup
- validate the key before saving it
- save the key to `~/.ownsearch/.env`
- offer automatic MCP installation for supported agents
- explain the built-in MCP retrieval guidance

Gemini API usage is governed by Google’s current free-tier limits, quotas, and pricing.

## Quickstart

Index a folder:

```bash
ownsearch index C:\path\to\folder --name my-folder
```

Check readiness:

```bash
ownsearch doctor
```

Inspect indexed roots:

```bash
ownsearch list-roots
```

Run exact search:

```bash
ownsearch literal-search "exact title or phrase" --limit 10
```

Run semantic search:

```bash
ownsearch search "your question here" --limit 5
```

Get grounded context:

```bash
ownsearch search-context "your question here" --limit 8 --max-chars 12000
```

Use deeper retrieval:

```bash
ownsearch deep-search-context "your question here" --final-limit 10 --max-chars 16000
```

Start the MCP server manually:

```bash
ownsearch serve-mcp
```

## Agent integration

OwnSearch can install MCP config automatically for supported clients:

```bash
ownsearch install-agent-config codex
ownsearch install-agent-config cursor
ownsearch install-agent-config vscode
ownsearch install-agent-config github-copilot
ownsearch install-agent-config copilot-cli
ownsearch install-agent-config windsurf
ownsearch install-agent-config continue
```

Supported targets:

- `codex`
- `cursor`
- `vscode`
- `github-copilot`
- `copilot-cli`
- `windsurf`
- `continue`
- `claude-desktop`

Notes:

- supported configs are merged without removing other MCP servers
- `claude-desktop` is not auto-installed because its current preferred flow is extension-based
- if automatic installation is not supported, OwnSearch falls back to a manual snippet

## CLI surface

- `ownsearch setup`
  Creates config, validates the environment, and sets up local dependencies.
- `ownsearch doctor`
  Returns a deterministic readiness verdict.
- `ownsearch index <folder> --name <name>`
  Indexes a folder incrementally.
- `ownsearch list-roots`
  Lists indexed roots.
- `ownsearch search "<query>"`
  Returns semantic hits.
- `ownsearch literal-search "<query>"`
  Returns exact text matches.
- `ownsearch search-context "<query>"`
  Returns a grounded context bundle.
- `ownsearch deep-search-context "<query>"`
  Returns a richer multi-query context bundle.
- `ownsearch delete-root <rootId>`
  Removes an indexed root and its vectors.
- `ownsearch store-status`
  Shows vector-store status.
- `ownsearch serve-mcp`
  Starts the stdio MCP server.
- `ownsearch install-agent-config <agent>`
  Installs or merges MCP config for a supported client.
- `ownsearch print-skill [skill]`
  Prints the bundled retrieval skill.

## Performance snapshot

OwnSearch has been benchmarked against more naive CLI-agent retrieval flows on local corpora.

Two reference corpora were used:

- a smaller archive-style corpus focused on ambiguity, contradiction handling, and multi-document retrieval
- a larger PDF-heavy D&D rules corpus focused on grounded question answering over long rulebooks

Observed pattern across those evals:

- `search_context` was usually the best default for agent efficiency
- `deep_search_context` was usually best when the question required broader recall or archive-style reconstruction
- naive CLI extraction or grep-heavy baselines were still useful in narrow exact-match cases, but materially worse as a primary agent interface

Representative D&D benchmark results:

| Method | Avg quality | Avg efficiency | Avg latency |
|---|---:|---:|---:|
| CLI extraction baseline, cold | `0.605` | `0.129` | `4850.7 ms` |
| CLI extraction baseline, warm | `0.605` | `0.318` | `25.5 ms` |
| `search_context` | `0.864` | `0.717` | `665.2 ms` |
| `deep_search_context` | `0.880` | `0.716` | `1615.3 ms` |

Interpretation:

- `search_context` was the strongest default for rules-style questions
- `deep_search_context` was slightly stronger on raw retrieval quality, but often not enough to justify the extra latency on simpler questions
- the indexed retrieval layer was materially more useful to agents than repeated ad hoc extraction

These numbers are reference evidence, not universal guarantees. New corpora should be evaluated with their own benchmark sets.

## Real-world fit

OwnSearch is a good fit when:

- documents must stay local
- agents need reliable grounded retrieval
- the corpus is mostly text
- repeated indexing is cheaper than repeated document scanning
- you want one MCP server instead of a custom retrieval stack per agent

It is less suitable when:

- the corpus is mostly scanned documents that require OCR
- the workflow depends heavily on spreadsheets or slide decks
- you need hosted multi-user search rather than local agent retrieval

## Limitations

Current hard limitations:

- no OCR for image-only PDFs
- no `.doc` support
- no spreadsheet or presentation extraction like `.xlsx` or `.pptx`
- no multimodal indexing in v1
- reranking is local and heuristic, not model-based

Operational limitations:

- retrieval quality still depends on query quality
- low-quality source documents reduce extraction quality
- duplicate-heavy corpora are improved, not fully solved
- `literal_search` depends on `ripgrep` being available locally
- very large corpora can still become expensive because embedding cost scales with chunk count

## Future scope

Planned directions:

- stronger learned reranking
- stronger cross-document deduplication
- richer extraction support
- watch mode for automatic reindexing
- HTTP MCP transport
- optional hosted deployment mode
- multimodal retrieval for images, audio, video, and richer documents

## Storage and local state

- config: `~/.ownsearch/config.json`
- shared env: `~/.ownsearch/.env`
- local Qdrant container: `ownsearch-qdrant`

`GEMINI_API_KEY` can come from:

- the shell environment
- the current working directory `.env`
- `~/.ownsearch/.env`

## License

MIT

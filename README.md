# ownsearch

**ownsearch** is a local retrieval layer for agents.

It indexes approved folders into a local Qdrant vector store, embeds content with Gemini, and exposes grounded retrieval through an MCP server so agents can search private documents without shipping those documents to a hosted RAG backend.

This package is designed for **text-first, local, agentic RAG**:

- local folders instead of SaaS document ingestion
- MCP-native access for agents
- grounded chunk retrieval instead of opaque long-context guessing
- predictable local storage with Docker-backed Qdrant

## Why it exists

Most agents waste time and tokens when they do one of two things:

- search too broadly with weak semantic queries
- skip retrieval and guess from partial context

`ownsearch` is meant to reduce both failure modes by:

- indexing local knowledge once
- making retrieval cheap and reusable
- giving agents a structured way to fetch only the chunks they need
- improving answer quality with reranking, deduplication, and grounded chunk access

It uses a hybrid retrieval surface rather than treating embeddings as a full replacement for exact search:

- `literal_search` for exact names, titles, IDs, and quoted phrases
- `search_context` for the normal fast semantic path
- `deep_search_context` for archive-style, multi-document, or ambiguity-heavy questions

## Core use cases

`ownsearch` is a good fit when an agent needs to work over:

- product documentation
- technical design docs
- code-adjacent text files
- contracts and policy documents
- research notes
- knowledge bases stored in folders
- PDF, DOCX, RTF, markdown, and plain-text heavy repositories

Typical agent workflows:

- answer questions over local docs
- locate the exact source file or section for a fact
- summarize a set of related files
- compare policy, spec, or contract language across documents
- support coding agents with repo-local documentation search
- reduce token cost by retrieving only relevant chunks instead of loading entire files

## What it does

- indexes local folders into a persistent vector store
- chunks and embeds supported files with Gemini
- supports incremental reindexing for changed and deleted files
- exposes search and context retrieval through MCP
- reranks and deduplicates result sets before returning them
- lets agents retrieve ranked hits, exact chunks, or bundled grounded context

## Current power

What is already strong in the current package:

- local-first setup with Docker-backed Qdrant
- deterministic readiness checks through `ownsearch doctor`
- multi-platform MCP config generation
- bundled retrieval skill for better query planning
- support for common text document formats
- large plain text and code files are no longer blocked by the extracted-document size cap
- repeatable smoke validation for mixed text corpora
- a hybrid retrieval interface that works better for agents than embeddings alone

## V1 supported document types

The current package is intended for text-first corpora, including:

- plain text and code files
- markdown and MDX
- JSON, YAML, TOML, CSV, XML, HTML
- PDF via text extraction
- DOCX via text extraction
- RTF via text extraction

## Deployment readiness

This package is ready to deploy for **text-first local document folders** when:

- Node.js `20+` is available
- Docker is available and Qdrant can run locally
- `GEMINI_API_KEY` is configured
- the document corpus is primarily text-based

Installation:

```bash
npm install -g ownsearch
```

Gemini API usage is governed by Google’s current free-tier limits, quotas, and pricing.

Deployment checklist:

```bash
npm install -g ownsearch
ownsearch setup
ownsearch doctor
ownsearch index C:\path\to\folder --name my-folder
ownsearch serve-mcp
```

If `ownsearch doctor` returns:

- `verdict.status: "ready"` then the package is operational
- `verdict.status: "action_required"` then follow the listed `nextSteps`

## Quickstart

```bash
ownsearch setup
ownsearch doctor
ownsearch index ./docs --name docs
ownsearch list-roots
ownsearch literal-search "exact title or phrase" --limit 10
ownsearch search "what is this repo about?" --limit 5
ownsearch search-context "what is this repo about?" --limit 8 --max-chars 12000
ownsearch deep-search-context "what is this repo about?" --final-limit 10 --max-chars 16000
ownsearch serve-mcp
```

On first run, `ownsearch setup` can:

- prompt for `GEMINI_API_KEY`
- explain the key-setup flow before opening Google AI Studio
- open Google AI Studio after the user confirms they are ready
- save the key to `~/.ownsearch/.env`
- validate the pasted key before saving it
- ask whether setup output should be optimized for a human or an agent
- print exact next commands for CLI and MCP usage
- offer to install MCP config automatically for supported agents
- optionally print an MCP config snippet for a selected agent

Gemini API usage is governed by Google’s current free-tier limits, quotas, and pricing.

Useful setup modes:

```bash
ownsearch setup
ownsearch setup --audience human
ownsearch setup --audience agent
ownsearch setup --json
```

## Real-world fit

`ownsearch` is a strong fit for:

- engineering teams with private docs that should stay local
- coding agents that need repo-adjacent design docs and runbooks
- consultants or operators working across contract, policy, or knowledge folders
- researchers who want grounded retrieval over local notes and exported reports
- teams trying to reduce agent token burn by retrieving small grounded context bundles instead of pasting entire files

It is less suitable when:

- the corpus is mostly scanned documents that need OCR
- the workflow depends on spreadsheets, slides, or legacy Office formats
- the main requirement is hosted multi-user search rather than local agent retrieval

## Agent integration

To print MCP config snippets:

```bash
ownsearch print-agent-config codex
ownsearch print-agent-config cursor
ownsearch print-agent-config vscode
ownsearch print-agent-config github-copilot
ownsearch print-agent-config copilot-cli
ownsearch print-agent-config windsurf
ownsearch print-agent-config continue
ownsearch print-agent-config claude-desktop
```

Supported config targets currently include:

- `codex`
- `cursor`
- `vscode`
- `github-copilot`
- `copilot-cli`
- `windsurf`
- `continue`
- `claude-desktop`

Notes:

- `claude-desktop` currently returns guidance rather than a raw JSON snippet because current Claude Desktop docs prefer desktop extensions (`.mcpb`) over manual JSON server configs
- all other supported targets return concrete MCP config payloads
- for supported agents, OwnSearch can also install the MCP server automatically without removing existing MCP servers:
  - `ownsearch install-agent-config codex`
  - `ownsearch install-agent-config cursor`
  - `ownsearch install-agent-config vscode`
  - `ownsearch install-agent-config github-copilot`
  - `ownsearch install-agent-config windsurf`
  - `ownsearch install-agent-config continue`
  - `ownsearch install-agent-config copilot-cli`

## Bundled skill

The package ships with a bundled retrieval skill:

```bash
ownsearch print-skill ownsearch-rag-search
```

The skill is intended to help an agent:

- rewrite weak user requests into stronger retrieval queries
- decide when to use `literal_search` vs `search_context` vs `deep_search_context` vs `get_chunks`
- recover from poor first-pass retrieval
- avoid duplicate-heavy answer synthesis
- stay grounded when retrieval is probabilistic

## CLI commands

- `ownsearch setup`
  Starts or reconnects to the local Qdrant Docker container, creates local config, persists `GEMINI_API_KEY`, and prints next-step commands.
- `ownsearch doctor`
  Checks config, Gemini key presence, Qdrant connectivity, collection settings, and emits a deterministic readiness verdict.
- `ownsearch index <folder> --name <name>`
  Indexes a folder incrementally into the local vector collection.
- `ownsearch list-roots`
  Lists approved indexed roots.
- `ownsearch search "<query>"`
  Returns reranked search hits from the vector store.
- `ownsearch literal-search "<query>"`
  Runs exact text search with `ripgrep` over indexed roots.
- `ownsearch search-context "<query>"`
  Returns a compact grounded context bundle for agents.
- `ownsearch deep-search-context "<query>"`
  Runs a deeper multi-query retrieval pass for ambiguous or archive-style questions.
- `ownsearch delete-root <rootId>`
  Removes a root from config and deletes its vectors from Qdrant.
- `ownsearch store-status`
  Shows collection status and vector configuration.
- `ownsearch serve-mcp`
  Starts the stdio MCP server.
- `ownsearch print-agent-config <agent>`
  Prints MCP config snippets or platform guidance.
- `ownsearch install-agent-config <agent>`
  Safely merges OwnSearch into a supported agent MCP config when the platform can be updated automatically.
- `ownsearch print-skill [skill]`
  Prints a bundled OwnSearch skill.

## MCP tools

The MCP server currently exposes:

- `get_retrieval_skill`
- `index_path`
- `search`
- `literal_search`
- `search_context`
- `deep_search_context`
- `get_chunks`
- `list_roots`
- `delete_root`
- `store_status`

Recommended retrieval flow:

1. Use `literal_search` when the user gives an exact title, name, identifier, or quoted phrase.
2. Use `search_context` for fast grounded retrieval.
3. Use `deep_search_context` for ambiguous, archive-style, or multi-document questions.
4. Use `search` when ranking and source inspection matter.
5. Use `get_chunks` when exact wording or detailed comparison matters.

## Validation

The package includes a repeatable smoke suite:

```bash
npm run smoke:text-docs
```

That smoke run currently validates:

- `.txt` retrieval
- `.rtf` retrieval
- `.docx` retrieval
- `.pdf` retrieval
- large plain text file bypass of the extracted-document byte cap

The repo also includes comparative retrieval evals:

- `scripts/eval-grep-vs-ownsearch.mts`
- `scripts/eval-adversarial-retrieval.mts`

These evals are meant to expose where:

- plain `grep` is still best
- shallow semantic retrieval is too weak
- deeper retrieval improves agent-facing RAG quality

On the current Mireglass benchmark corpus, the latest comparative run produced:

- `deep`: `69.2` average score
- `grep`: `65.67` average score
- `shallow`: `65.09` average score

The adversarial eval also showed that the current deep path reduced known noise-file leakage the most in this corpus.

## Limitations

This package is deploy-ready for text-first corpora, but it is not universal document intelligence.

Current hard limitations:

- no OCR for image-only PDFs
- no `.doc` support
- no spreadsheet or presentation extraction such as `.xlsx` or `.pptx`
- no multimodal embeddings yet
- reranking is heuristic and local, not yet model-based
- very large corpora can still become expensive because embedding cost scales with chunk count

Operational limitations:

- retrieval quality still depends on query quality
- extracted document quality depends on source document quality
- duplicate-heavy corpora are improved by current reranking, but not fully solved for all edge cases
- scanned or low-quality PDFs may require OCR before indexing
- `literal_search` depends on `ripgrep` being available on the local machine
- exact literal lookup can still beat semantic retrieval on some questions, so agents should use the hybrid flow instead of embeddings alone

## Future scope

Planned next-stage improvements:

- pluggable learned rerankers
- stronger deduplication across overlapping corpora
- richer document extraction
- watch mode for automatic local reindexing
- HTTP MCP transport
- optional hosted deployment mode
- multimodal indexing and retrieval for:
  - images
  - audio
  - video
  - richer document formats

The multimodal phase will require careful collection migration because Gemini text and multimodal embedding spaces are not interchangeable across model families.

## Notes

- config is stored in `~/.ownsearch/config.json`
- shared CLI and MCP secrets can be stored in `~/.ownsearch/.env`
- Qdrant runs locally in Docker as `ownsearch-qdrant`
- `GEMINI_API_KEY` may come from the shell environment, the current working directory `.env`, or `~/.ownsearch/.env`
- `maxFileBytes` primarily applies to extracted document formats such as PDF, DOCX, and RTF, not to large plain text and code files

## License

MIT

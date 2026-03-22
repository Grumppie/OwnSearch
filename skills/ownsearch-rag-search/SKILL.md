---
name: ownsearch-rag-search
description: Improve retrieval quality when an agent uses OwnSearch MCP tools to search local documents. Use for semantic search, grounded answering, query rewriting, multi-query retrieval, exact chunk fetches, duplicate-heavy result sets, or whenever a user request must be translated into stronger OwnSearch search_context/search/get_chunks calls.
---

# OwnSearch RAG Search

## Overview

Use this skill to bridge the gap between what a user asks and what OwnSearch should retrieve. Treat retrieval as probabilistic: rewrite weak queries, run multiple targeted searches when needed, prefer grounded context over guesswork, and fetch exact chunks before making precise claims.

## Retrieval Workflow

1. Classify the user request.
2. Generate one to four retrieval queries.
3. Start with `search_context` for the strongest query.
4. Expand to additional searches only if evidence is weak, duplicate-heavy, or incomplete.
5. Use `get_chunks` after `search` when the answer needs exact wording, detailed comparison, or citation-grade grounding.
6. Answer only from retrieved evidence. Say when the retrieved context is insufficient.

## Query Planning

Generate retrieval queries with these patterns:

- Literal query: preserve the exact noun phrase, error string, rule name, or title the user used.
- Canonical query: replace vague wording with domain terms likely to appear in documents.
- Paraphrase query: restate the intent in simpler or more explicit language.
- Source-biased query: add likely file names, section names, or path hints when the user names a source.

Good examples:

- User ask: "How do concentration checks work?"
  Queries:
  - `concentration checks`
  - `maintain concentration after taking damage`
  - `constitution saving throw concentration spell`

- User ask: "Where does the repo explain local MCP setup?"
  Queries:
  - `local MCP setup`
  - `Model Context Protocol setup`
  - `serve-mcp agent config`

- User ask: "What did the contract say about payment timing?"
  Queries:
  - `payment timing`
  - `payment due within`
  - `invoice due date net terms`

## Tool Use Rules

Use `search_context` when:

- the user wants an answer, summary, explanation, or quick grounding
- the answer can be supported by a few chunks
- low latency matters more than exhaustive recall

Use `search` when:

- you want to inspect ranking and source distribution
- you need to compare multiple candidates
- you suspect duplicates or poor recall

Use `get_chunks` when:

- exact wording matters
- the answer depends on adjacent details
- you need to quote or carefully verify a claim
- you need to compare similar hits before answering

## Duplicate Handling

Assume top results can still contain semantic duplicates.

When results are duplicate-heavy:

- keep only the strongest chunk per repeated claim unless neighboring chunks add new facts
- prefer source diversity when multiple files say the same thing
- if one document clearly appears authoritative, prefer that source but mention corroboration when useful
- if the top results are all from one file and the answer still seems incomplete, issue a second query with a different phrasing

## Failure Recovery

If the first search is weak:

- shorten the query
- remove conversational filler
- swap vague words for canonical terms
- split compound questions into separate searches
- add likely section names or file hints
- search once for the concept and once for the expected answer shape

Examples:

- "Can you tell me what they said about when we can terminate this thing?"
  Retry with:
  - `termination`
  - `termination notice`
  - `right to terminate`
  - `termination for cause`

- "Why is my build exploding around env handling?"
  Retry with:
  - `environment variables`
  - `dotenv`
  - `GEMINI_API_KEY`
  - `setup envPath`

## Answering Rules

- Do not invent facts that were not retrieved.
- Prefer citing file paths or chunk provenance when the client supports it.
- If retrieval is partial, say which part is grounded and which part is uncertain.
- If evidence conflicts, surface the conflict instead of averaging it away.
- If nothing relevant is retrieved after a few query variants, say so explicitly.

## Minimal Playbook

For a normal grounded answer:

1. Derive two or three strong retrieval queries.
2. Call `search_context` with the best query.
3. If results look sufficient, answer from them.
4. If results look weak or ambiguous, call `search` with another variant.
5. Fetch exact chunks for the best IDs before making precise claims.

For a locate-the-source task:

1. Use `search` first.
2. Inspect which files dominate.
3. Use `get_chunks` on top hits.
4. Return the most relevant files and sections, not just a prose answer.

For a compare-or-summarize task:

1. Run one query per subtopic.
2. Collect grounded chunks from each.
3. Merge only non-duplicate evidence.
4. Summarize with explicit source-backed differences.

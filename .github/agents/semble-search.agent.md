---
name: semble-search
description: Code search agent for exploring any codebase. Use for finding code by intent, locating implementations, understanding how something works, or discovering related code. Prefer over Grep/Glob/Read for any semantic or exploratory question.
tools: Bash, Read
---

Use `semble search` to find code by describing what it does or naming a symbol/identifier, instead of grep:

```bash
semble search "authentication flow" . --max-snippet-lines 10
semble search "save_pretrained" .
semble search "save model to disk" . --top-k 10
```

Results are cached automatically on first run and invalidated when files change.

Use `--content docs` to search documentation and prose, `--content config` for config files, or `--content all` to search code, docs, and config:

```bash
semble search "deployment guide" . --content docs
semble search "database host port" . --content config
semble search "authentication" . --content all
```

Use `semble find-related` to discover code similar to a specific location:

```bash
semble find-related src/auth.py 42 .
```

If `semble` is not on `PATH`, use `mise exec -- uvx --from "semble[mcp]==0.4.1" semble` in its place.

### Workflow

1. Start with `semble search` to find relevant chunks.
2. Select `--content docs`, `--content config`, or `--content all` when the query is not limited to code.
3. Navigate directly to the returned file and line. Do not re-search or grep for the same content.
4. Use `semble find-related` with a promising result to discover related implementations, callers, or tests.
5. Use `rg` only when every occurrence of a literal string is required.

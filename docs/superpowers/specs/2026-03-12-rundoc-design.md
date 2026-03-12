# rundoc Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

rundoc is a CLI tool that makes markdown code snippets runnable. It is a lightweight alternative to Jupyter notebooks. You point it at a markdown file, it opens a browser showing a rendered version of that file, and code snippets have a "Run" button. When you run a snippet, the output is written back into the markdown file as an ` ```output ` block — making results portable and viewable in any standard markdown renderer.

## Stack

- **Runtime:** Deno (distributed as a single compiled binary via `deno compile`)
- **Server:** Hono
- **Markdown parsing:** `npm:marked`
- **Frontend interactivity:** HTMX (CDN, no build step)
- **Styling:** minimal inline CSS

## CLI Interface

```
rundoc <file.md> [--port 7700] [--no-open]
```

- Starts a Hono HTTP server on the given port (default: `7700`)
- Auto-opens the browser at `http://localhost:<port>` unless `--no-open` is passed
- Watches the file for external changes and refreshes the browser via a simple SSE polling endpoint
- Distributed as a single binary compiled with `deno compile`

## Architecture

```
rundoc <file.md>
    │
    ├── Hono HTTP server (localhost:PORT)
    │     ├── GET /        → render full HTML page
    │     ├── POST /run    → execute snippet, write output, return HTML fragment
    │     └── GET /events  → SSE endpoint for file-change page refresh
    │
    ├── Markdown processor (marked)
    │     ├── Parse fenced code blocks, assign each an index (0, 1, 2...)
    │     ├── Inject HTMX run buttons for known-language snippets
    │     └── Associate existing ```output blocks with the preceding snippet
    │
    ├── Language runner (Deno.Command)
    │     ├── Language → command mapping
    │     └── Spawn subprocess, capture stdout+stderr, enforce 30s timeout
    │
    └── File writer
          └── Add or replace ```output block immediately after the code block
```

## Language Support

Only languages with a known inline execution flag are supported. Unknown language tags render as plain code blocks without a Run button.

| Tag(s) | Command |
|--------|---------|
| `js`, `javascript` | `deno eval <code>` |
| `ts`, `typescript` | `deno eval --ext=ts <code>` |
| `python`, `py` | `python3 -c <code>` |
| `bash`, `sh` | `bash -c <code>` |
| `ruby` | `ruby -e <code>` |

## HTTP Routes & HTMX Interaction

### `GET /`
Reads the `.md` file, parses it, and returns a full HTML page with:
- HTMX loaded from CDN
- SSE listener for file-change refresh
- Rendered markdown with run buttons and output blocks injected

### `POST /run`
Request body: `{ index: number }`

1. Looks up the snippet at the given index
2. Runs it via the language runner
3. Writes/replaces the `output` block in the source `.md` file
4. Returns an HTML fragment: the updated `<pre id="output-{index}">` element

### HTMX wiring per runnable snippet:
```html
<button
  hx-post="/run"
  hx-vals='{"index": 3}'
  hx-target="#output-3"
  hx-swap="outerHTML"
  hx-indicator="#spinner-3"
>Run</button>
<span id="spinner-3" class="htmx-indicator">running…</span>
<pre id="output-3"></pre>
```

HTMX swaps the returned `<pre>` fragment in place — no page reload, no custom JavaScript.

## Output File Format

Output is written back to the source markdown file as a fenced ` ```output ` block immediately following the code snippet:

````markdown
```js
console.log(1 + 1);
```

```output
2
```
````

- On re-run, the existing ` ```output ` block is replaced in-place
- stdout and stderr are merged into the output block
- The file is updated atomically (write to temp, rename)

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Non-zero exit code | stderr included in the `output` block — visible inline like a notebook |
| Interpreter not found | Output block contains `Error: <interpreter> not found` |
| Timeout (30s) | Process killed; output block contains `Error: timed out after 30s` |
| File not readable | CLI exits with a clear error message before starting the server |

## File Watching

- The server watches the `.md` file using `Deno.watchFs`
- Changes are broadcast to the browser via a Server-Sent Events endpoint (`GET /events`)
- The browser reloads the page on receiving a change event
- This covers the case where the user edits the file externally while rundoc is running

## Distribution

```sh
deno compile \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-run \
  --output rundoc \
  src/main.ts
```

Produces a single self-contained binary. No Deno installation required on the end user's machine.

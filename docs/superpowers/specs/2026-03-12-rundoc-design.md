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
- Watches the file for external changes and refreshes the browser via SSE
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
    │     ├── Parse fenced code blocks, assign each a sequential index (0, 1, 2...)
    │     ├── Output blocks (lang="output") are excluded from the index sequence
    │     ├── Inject HTMX run buttons for known-language snippets
    │     └── Associate existing output blocks with the preceding snippet
    │
    ├── Language runner (Deno.Command)
    │     ├── Language → temp file extension + command mapping
    │     └── Spawn subprocess, capture stdout+stderr interleaved, enforce 30s timeout
    │
    └── File writer
          └── Add or replace output block immediately after the code block
```

## Language Support

Only languages with a known interpreter are supported. Unknown language tags render as plain code blocks without a Run button.

All snippets are written to a temporary file with the appropriate extension before execution, avoiding shell quoting issues. Temp files are created in the OS temp directory and deleted after execution.

| Tag(s) | Extension | Command |
|--------|-----------|---------|
| `js`, `javascript` | `.js` | `deno run <tmpfile>` |
| `ts`, `typescript` | `.ts` | `deno run <tmpfile>` |
| `python`, `py` | `.py` | `python3 <tmpfile>` |
| `bash` | `.sh` | `bash <tmpfile>` |
| `sh` | `.sh` | `sh <tmpfile>` |
| `ruby` | `.rb` | `ruby <tmpfile>` |

**Note:** Running `js`/`ts` snippets requires `deno` to be present on the user's `PATH` — the compiled rundoc binary does not bundle a JS runtime. If `deno` is not installed, the run will produce an "interpreter not found" error.

### Interpreter not found detection

"Interpreter not found" is detected by catching a spawn error from `Deno.Command` (i.e., `ENOENT` — the executable does not exist on `PATH`). This is distinct from a non-zero exit code, which indicates the interpreter ran but the snippet failed.

## HTTP Routes & HTMX Interaction

### `GET /`
Reads the `.md` file, parses it, and returns a full HTML page with:
- HTMX loaded from CDN
- SSE listener for file-change refresh
- Rendered markdown with run buttons and output blocks injected

### `POST /run`
Request body: form-encoded (`application/x-www-form-urlencoded`), field: `index=<number>`

HTMX sends form-encoded data by default; the server parses `index` as a base-10 integer from the form field string value.

Processing steps:
1. Acquire the per-file run mutex (queue depth: 1 — a second concurrent request is dropped with HTTP 429)
2. Re-read and re-parse the file to resolve the current snippet at `index`
3. Run it via the language runner
4. Write/replace the output block in the source `.md` file
5. Record `lastRunWriteAt = Date.now()` to suppress the resulting watchFs event
6. Return an HTML fragment: the updated `<pre id="output-{index}">` element

**Concurrency:** At most one run executes at a time. If a run is already in progress, the incoming request is immediately rejected with HTTP 429 (Too Many Requests). The snippet list is always re-read from disk at step 2 (not captured at request time) to avoid stale index issues. The lock is always released after the child process exits or is killed — regardless of exit code, error, or timeout.

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

The empty `<pre id="output-{index}"></pre>` element is **always rendered** in the page, even when no output block exists yet in the source file. This ensures `hx-target` always resolves on first run.

HTMX swaps the returned `<pre>` fragment in place — no page reload, no custom JavaScript.

## Output File Format

Output is written back to the source markdown file as a fenced ` ```output ` block. The file writer inserts exactly one blank line between the closing fence of the snippet and the opening fence of the output block:

````markdown
```js
console.log(1 + 1);
```

```output
2
```
````

- On re-run, the existing ` ```output ` block is replaced in-place
- stdout and stderr are merged with interleaved ordering by using `stderr: "stdout"` in `Deno.Command`, redirecting stderr to stdout's pipe at the OS level
- The file is written atomically (write to temp file, then `Deno.rename`)

### Output block association rules

An ` ```output ` block is associated with snippet N if and only if:
- It is a fenced code block with the language tag `output`
- It appears after snippet N's closing fence
- There is no intervening content between them other than blank lines (any number of whitespace-only lines is acceptable)
- A subsequent fenced code block with any language tag (including another runnable snippet) breaks the association

Output blocks are not assigned indices and are excluded from the snippet index sequence.

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Non-zero exit code | stderr included in the `output` block — visible inline like a notebook |
| Interpreter not found (`ENOENT`) | Output block contains `Error: <interpreter> not found` |
| Timeout (30s) | Process killed with `SIGKILL` via the process handle; output block contains `Error: timed out after 30s`; lock released |
| Concurrent run in progress | HTTP 429 returned; no file write occurs |
| File not readable on startup | CLI exits with a clear error message before starting the server |
| File not writable at run time | Returns an error HTML fragment to the browser; output block is not written |

## File Watching

- The server watches the `.md` file using `Deno.watchFs`
- Only `modify` and `rename` events on the exact target file path trigger a broadcast
- A 100ms debounce is applied before broadcasting
- Suppression: if `Date.now() - lastRunWriteAt < 500`, the event is ignored — this prevents the file write from `POST /run` triggering an SSE page reload that races with the HTMX swap. Note: on some filesystems, the atomic rename may generate events on the temp file path rather than the target path; the 500ms suppression window covers this case regardless of the reported path.
- Changes are broadcast to connected browsers via SSE (`GET /events`)
- The browser performs a full page reload on receiving a change event

**Known limitation — SSE reconnect:** Standard `EventSource` reconnects automatically after a drop. If the browser reconnects and immediately receives a stale event, it may reload unnecessarily. This is not handled; it is an acceptable edge case for a local dev tool.

**Known limitation — external edits during a run:** Snippets are identified by index (0, 1, 2...). If the file is edited externally between page load and clicking Run (adding or removing snippets before the target snippet), the index will resolve to a different snippet and the output block will be written to the wrong location. Users should avoid editing the file while a run is in progress.

## Distribution

```sh
deno compile \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-run=deno,python3,bash,sh,ruby \
  --output rundoc \
  src/main.ts
```

`--allow-run` is scoped to the exact set of interpreters in the language support table. Produces a single self-contained binary — no Deno installation required on the end user's machine (except `deno` itself, if running `js`/`ts` snippets).

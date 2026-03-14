# mini — minimal rundown experiment

**Date:** 2026-03-13

A stripped-down version of rundown: a Python stdlib HTTP server + single HTML file that lets you view/edit a markdown file and run shell code snippets in-place.

## Files

```
mini/
  server.py   # HTTP server — zero dependencies, stdlib only
  index.html  # UI — marked.js@14 from CDN, vanilla JS
```

## Server routes (`server.py`)

- `GET /` → serve `index.html`
- `GET /content` → return raw markdown as `text/plain`
- `POST /run` (form: `index=N`) → find Nth shell block, run with `subprocess`, write output block back to file, return output text
- `POST /save` (body: full updated markdown as plain text) → write to file (set in-memory suppress flag before write, clear after; SSE watcher skips notification while flag is set; server uses a single-threaded `HTTPServer` so no locking needed)
- `GET /events` → SSE; poll `os.stat` mtime every 1s in a background thread, emit `data: change\n\n` when mtime changes and suppress flag is not set

Server started with: `python3 mini/server.py notes.md`

## Client (`index.html`)

- Fetch `/content` on load → store as `rawSource` string → render with `marked.js` → post-process `sh`/`bash`/`shell` fences to add Run buttons and output areas; store each block's raw fence text in a `data-raw` attribute on its wrapper element
- **Run:** POST `index=N` to `/run`, update output area in-place with returned text; do not modify `rawSource` (server writes the file; next SSE change event or next `/content` fetch will sync)
- **Edit:** click cell → textarea prefilled with `cell.dataset.raw`; Cmd+Enter → replace that exact string in `rawSource` with the new content → POST full `rawSource` to `/save` → on success, re-fetch `/content`, update `rawSource`, re-render
- **Live reload:** `EventSource('/events')` → on `change`, re-fetch `/content`, update `rawSource`, re-render

## Output format

A bare ` ```output ``` ` fence immediately after the shell block. This intentionally diverges from the main project's `output:` label convention — interoperability with the main tool is not a goal.

**`/run` output-block algorithm:**

1. Regex-scan the file for all ` ```sh/bash/shell ... ``` ` fences, in order, skipping any ` ```output ``` ` fence that immediately follows a shell fence (so output blocks aren't counted as shell blocks).
2. Select the Nth fence (0-indexed).
3. Check whether the text immediately after that fence is a ` ```output ``` ` block; if yes, replace it; if no, insert one.
4. Write the updated file.

## Constraints

- No pip installs — stdlib only on the server
- No JS build step — single HTML file, CDN only (`marked.js@14` pinned major version)
- Shell snippets only (`sh`, `bash`, `shell` fence tags — intentionally a fixed list, not synced with main project's `KNOWN_LANGUAGES`)
- 30s subprocess timeout

## Known limitations

- **Write race:** `/run` and `/save` both write the file. A concurrent run + edit will result in one clobbering the other. Accepted for this experiment — no mitigation.
- **Duplicate blocks:** The edit flow replaces `cell.dataset.raw` in `rawSource` using a string replacement. If the same code block appears twice in the document, the first occurrence is always replaced. Accepted for this experiment.
- **Index alignment:** Both the client (when numbering Run buttons) and the server (when scanning for the Nth shell block in `/run`) count only `sh`/`bash`/`shell` fences and skip `output` fences. This must be kept consistent.

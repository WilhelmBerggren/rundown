# Inline Cell Editing Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

Add Jupyter-style inline editing to rundown's web interface. Every rendered block (heading, paragraph, list, code snippet) becomes a clickable "cell". Clicking a cell replaces it with a textarea containing the raw markdown source. `Cmd/Ctrl+Enter` saves the edit back to the `.md` file and re-renders the cell in place. `Escape` cancels.

## Cell Model

Every rendered markdown token is a **cell** — a `<div data-cell="N" data-raw="...">` wrapper where `N` is a sequential integer (0, 1, 2…) assigned across all rendered tokens. `data-raw` holds the verbatim source text taken from `token.raw` (marked's built-in property).

**Excluded from the cell model** (no `data-cell`, not editable, counter does NOT increment):
- `space` tokens (blank lines between blocks) — must be explicitly `continue`d in all three token-walking functions so they never receive a `data-cell` wrapper
- `output:` label paragraphs (auto-generated, suppressed in rendering)
- `` ```output `` blocks (auto-generated, suppressed in rendering)

**Included as cells** (counter increments, receives `data-cell`):
- All rendered tokens not in the exclusion list above, including:
  - Headings, paragraphs, lists, blockquotes, hr, etc.
  - Known-language code blocks (rendered as `.snippet` with Run button)
  - **Unknown-language code blocks** (rendered as plain `<pre><code>` — editable, no Run button)

All three token-walking functions (`renderPage`, `updateBlock`, `renderCellFragment`) must use identical exclusion logic so cell indices stay in sync.

Example — a document with a heading, paragraph, and code snippet produces cells 0, 1, 2.

## Architecture

### New: `POST /edit` route (`server.ts`)

Request body (form-encoded): `cell=N&content=<new markdown>`

Processing steps:
1. Parse and validate `cell` (integer) and `content` (string)
2. Re-read the file
3. Call `updateBlock(fileContent, N, newMarkdown)` → updated file string
4. Call `watcher.suppress()` **before** writing (same ordering as `POST /run`)
5. Write file atomically via `writeOutput`
6. Call `renderCellFragment(updatedContent, N)` → HTML fragment
7. Return the fragment

**Concurrency:** No run mutex needed — file writes are atomic and the watcher is suppressed. Concurrent edits are unlikely in a single-user local tool; last write wins.

**Accepted race — edit vs. run:** A `POST /run` write can land between `POST /edit`'s file re-read (step 2) and its write (step 5), causing the edit to overwrite the run's output block. This is an accepted limitation for a single-user local tool. Users should avoid clicking Run while a cell editor is open.

### New: `updateBlock(content, cellIndex, newMarkdown)` (`writer.ts`)

Replaces the source text of cell `cellIndex` with `newMarkdown`.

Algorithm:
1. Lex `content` with `Lexer.lex`
2. Walk tokens with two parallel trackers:
   - `cellCount` — increments only for non-excluded tokens (the cell index)
   - `searchFrom` — a cursor into the source string that advances past **every** token's raw text, including excluded ones. For each token: `const pos = content.indexOf(token.raw, searchFrom); if (pos !== -1) searchFrom = pos + token.raw.length;`
3. For excluded tokens (space / `output:` paragraphs / `output` code blocks): advance `searchFrom` but do NOT increment `cellCount`, then `continue`
4. For non-excluded tokens: if `cellCount === cellIndex`, use `pos` found in step 2 to splice: `content.slice(0, pos) + newMarkdown + content.slice(pos + token.raw.length)` and return. Otherwise increment `cellCount`.
5. Throw if the cell index is not found

Note: `searchFrom` must advance even for skipped/excluded tokens. Without this, the cursor would lag behind excluded tokens and `indexOf` could find a spurious earlier match for a subsequent non-excluded token.

### New: `renderCellFragment(content, cellIndex)` (`markdown.ts`)

Re-lexes `content`, finds the token at `cellIndex` using the same walk as `updateBlock` (identical exclusion rules, identical `searchFrom` advancement), and returns the rendered `<div data-cell="N" data-raw="...">` HTML for that single cell. Used by `POST /edit` to build its response fragment. Throws if the cell index is not found (same as `updateBlock`).

### Modified: `renderPage` (`markdown.ts`)

Wrap every rendered token in a `<div data-cell="N" data-raw="<escaped token.raw>">` element. Apply the same exclusion rules (with explicit `continue` for space tokens) to assign cell indices. The existing `snippetIndex` (for Run buttons) remains a separate counter.

The `.snippet` wrapper for known-language code cells becomes the cell wrapper itself:
```html
<div data-cell="2" data-raw="```js&#10;console.log(1)&#10;```" class="snippet">
  <pre><code>...</code></pre>
  <button hx-post="/run" ...>Run</button>
  ...
</div>
```

Unknown-language code cells (no Run button):
```html
<div data-cell="3" data-raw="```mermaid&#10;graph LR&#10;A-->B&#10;```">
  <pre><code class="language-mermaid">graph LR&#10;A-->B</code></pre>
</div>
```

Non-snippet prose cells:
```html
<div data-cell="0" data-raw="# Hello">
  <h1>Hello</h1>
</div>
```

## Client-Side Interaction

A small vanilla JS block is added to the existing `<script>` section. No new dependencies.

### Click handler (event delegation)

```
document.addEventListener('click', handler)
```

- Skip if target is a `<button>` (preserves Run button)
- Skip if any cell is already `.editing`
- Find `closest('[data-cell]')` — if none, ignore
- Call `startEditing(cell)`

### `startEditing(cell)`

1. Store `originalHTML = cell.innerHTML`
2. Add class `editing` to cell
3. Populate textarea using `cell.dataset.raw` — the browser automatically decodes HTML entities in attribute values, so `dataset.raw` yields the verbatim markdown string (correct for fenced blocks with newlines encoded as `&#10;`). Do not use `getAttribute('data-raw')` with manual unescaping. The `data-raw` attribute is escaped using the same four-character set as the rest of the page (`&amp;`, `&lt;`, `&gt;`, `&quot;`) so `dataset.raw` will decode all of them correctly.
4. Replace `cell.innerHTML` with:
   ```html
   <textarea><!-- cell.dataset.raw --></textarea>
   <div class="edit-hint"></div>
   ```
5. Focus the textarea, select all
6. Attach `keydown` listener:
   - `Escape` → `cancelEditing(cell, originalHTML)`
   - `Cmd/Ctrl+Enter` → `saveEdit(cell, textarea.value)`

### `cancelEditing(cell, originalHTML)`

Restore `cell.innerHTML = originalHTML`, remove `.editing` class.

### `saveEdit(cell, newContent)`

```
POST /edit  (form-encoded: cell=N&content=newContent)
```

Check the HTTP status **before** touching the DOM:

- On error (non-2xx): show a brief inline error message inside the cell; restore editing state (re-populate textarea, keep `.editing` class) so the user doesn't lose their work. The `cell` reference remains valid.
- On success (2xx): set `cell.outerHTML = responseText`. After this assignment the `cell` variable is a detached node — no further access to `cell` should occur. The new element in the DOM has the correct `data-cell` and `data-raw` for future edits.

### CSS additions (inline `<style>`)

The `<style>` block is in a TypeScript string literal in `markdown.ts`, which is saved as UTF-8. The `⌘` and `↵` glyphs in the `content:` property are valid UTF-8 and will render correctly in the browser.

```css
[data-cell] { cursor: text; border-radius: 4px; padding: 0.2rem 0.4rem; }
[data-cell]:hover { background: #f9f9f9; outline: 1px dashed #ddd; }
[data-cell].editing { outline: 2px solid #4f8ef7; background: #f0f6ff; }
[data-cell].editing textarea {
  width: 100%; box-sizing: border-box;
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: inherit; line-height: inherit;
  resize: vertical; min-height: 2em;
}
.edit-hint { display: none; font-size: 0.72rem; color: #4f8ef7; text-align: right; margin-top: 0.2rem; }
.edit-hint::after { content: "⌘↵ save  ·  Esc cancel"; }
[data-cell].editing .edit-hint { display: block; }
```

The hint element is always present in the DOM while editing — made visible by CSS alone, no JS required.

## Watcher Suppression

`POST /edit` calls `watcher.suppress()` **before** `writeOutput`, matching the ordering in `POST /run`. This starts the 500 ms suppression window before the atomic rename occurs, ensuring the resulting `watchFs` events (which can fire up to ~100 ms after the rename on some filesystems) fall within the window and do not trigger a full page reload that would race with the HTMX cell fragment swap.

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Invalid `cell` index | HTTP 400; client shows inline error, preserves textarea |
| File not writable | HTTP 500; client shows inline error, preserves textarea |
| Concurrent `/run` in progress | No conflict — edit writes are independent of the run mutex |
| `token.raw` not found in source | `updateBlock` throws; server returns HTTP 500 |

## What Is Not Editable

- `output:` label paragraphs — suppressed in rendering, no `data-cell`
- `` ```output `` blocks — suppressed in rendering, no `data-cell`
- Running a snippet still replaces its output block as before

## Known Limitation

Cell indices are positional. If the file is edited externally between page load and clicking a cell (adding or removing blocks before the target), the index will resolve to a different block. Users should avoid external edits while a cell editor is open. (Same class of limitation as the existing run-button index issue, already noted in the original spec.)

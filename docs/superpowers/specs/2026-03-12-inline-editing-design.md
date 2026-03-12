# Inline Cell Editing Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

Add Jupyter-style inline editing to rundoc's web interface. Every rendered block (heading, paragraph, list, code snippet) becomes a clickable "cell". Clicking a cell replaces it with a textarea containing the raw markdown source. `Cmd/Ctrl+Enter` saves the edit back to the `.md` file and re-renders the cell in place. `Escape` cancels.

## Cell Model

Every rendered markdown token is a **cell** — a `<div data-cell="N" data-raw="...">` wrapper where `N` is a sequential integer (0, 1, 2…) assigned across all rendered tokens. `data-raw` holds the verbatim source text taken from `token.raw` (marked's built-in property).

**Excluded from the cell model** (no `data-cell`, not editable):
- `space` tokens (blank lines between blocks)
- `output:` label paragraphs (auto-generated, already suppressed in rendering)
- `` ```output `` blocks (auto-generated, already suppressed in rendering)

Example — a document with a heading, paragraph, and code snippet produces cells 0, 1, 2.

## Architecture

### New: `POST /edit` route (`server.ts`)

Request body (form-encoded): `cell=N&content=<new markdown>`

Processing steps:
1. Parse and validate `cell` (integer) and `content` (string)
2. Re-read the file
3. Call `updateBlock(content, N, newMarkdown)` → updated file string
4. Suppress watcher + write file atomically (same pattern as `POST /run`)
5. Call `renderCellFragment(updatedContent, N)` → HTML fragment
6. Return the fragment

**Concurrency:** No run mutex needed — file writes are atomic and the watcher is suppressed. Concurrent edits are unlikely in a single-user local tool; last write wins.

### New: `updateBlock(content, cellIndex, newMarkdown)` (`writer.ts`)

Replaces the source text of cell `cellIndex` with `newMarkdown`.

Algorithm:
1. Lex `content` with `Lexer.lex`
2. Walk tokens, skipping excluded tokens (space / `output:` paragraphs / `output` code blocks) — same exclusion logic as `renderPage`
3. Maintain a `searchFrom` cursor into the source string, advancing it past each token's raw text using `content.indexOf(token.raw, searchFrom)` — this handles duplicate blocks correctly
4. When the target cell index is reached, splice: `content.slice(0, pos) + newMarkdown + content.slice(pos + token.raw.length)`
5. Throw if the cell index is not found

### New: `renderCellFragment(content, cellIndex)` (`markdown.ts`)

Re-lexes `content`, finds the token at `cellIndex` (same walk as `updateBlock`), and returns the rendered `<div data-cell="N" data-raw="...">` HTML for that single cell. Used by `POST /edit` to build its response fragment.

### Modified: `renderPage` (`markdown.ts`)

Wrap every rendered token in a `<div data-cell="N" data-raw="<escaped token.raw>">` element. Apply the same exclusion rules to assign cell indices. The existing `snippetIndex` (for Run buttons) remains a separate counter.

The `.snippet` wrapper for code cells becomes the cell wrapper itself:
```html
<div data-cell="2" data-raw="```js&#10;console.log(1)&#10;```" class="snippet">
  <pre><code>...</code></pre>
  <button hx-post="/run" ...>Run</button>
  ...
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
3. Replace `cell.innerHTML` with:
   ```html
   <textarea><!-- data-raw value, HTML-decoded --></textarea>
   <div class="edit-hint"></div>
   ```
4. Focus the textarea, select all
5. Attach `keydown` listener:
   - `Escape` → `cancelEditing(cell, originalHTML)`
   - `Cmd/Ctrl+Enter` → `saveEdit(cell, textarea.value)`

### `cancelEditing(cell, originalHTML)`

Restore `cell.innerHTML = originalHTML`, remove `.editing` class.

### `saveEdit(cell, newContent)`

```
POST /edit  (form-encoded: cell=N&content=newContent)
```

On success: set `cell.outerHTML` to response text (the re-rendered fragment). The new element has correct `data-cell` and `data-raw` for future edits.

On error: show a brief inline error message inside the cell; restore editing state so the user doesn't lose their work.

### CSS additions (inline `<style>`)

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

The hint is always present in the DOM while editing — made visible by CSS alone.

## Watcher Suppression

`POST /edit` suppresses the SSE watcher using the same `watcher.suppress()` mechanism as `POST /run`. This prevents the file write from triggering a full page reload that would race with the cell fragment swap.

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

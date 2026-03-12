# Inline Cell Editing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every rendered markdown block a clickable cell that can be edited inline from the browser and saved back to the source file.

**Architecture:** Each rendered token gets a `data-cell="N"` wrapper div with `data-raw` containing the escaped source markdown. A new `POST /edit` route replaces the cell's source text and returns the re-rendered HTML fragment. Client-side vanilla JS handles click-to-edit, save (`Cmd/Ctrl+Enter`), and cancel (`Escape`). Three functions share identical token-walking logic — `renderPage`, `renderCellFragment`, and `updateBlock` — to keep cell indices always in sync.

**Tech Stack:** Deno, Hono, marked (Lexer/Parser), HTMX (existing), vanilla JS, inline CSS.

**Spec:** `docs/superpowers/specs/2026-03-12-inline-editing-design.md`

---

## Chunk 1: Backend logic — updateBlock + renderPage cell wrappers

### Task 1: `updateBlock` in `writer.ts`

`updateBlock` finds a cell by index in the markdown source and replaces its raw text with new markdown. It's a new export alongside the existing `updateOutputBlock`.

**Files:**
- Modify: `src/writer.ts`
- Test: `tests/writer_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/writer_test.ts`:

```typescript
import { updateBlock } from "../src/writer.ts"; // add to existing import line
```

```typescript
Deno.test("updateBlock: replaces a single paragraph", () => {
  // token.raw for a paragraph includes trailing newline
  const content = "Hello world\n";
  const result = updateBlock(content, 0, "Updated paragraph\n");
  assertEquals(result, "Updated paragraph\n");
});

Deno.test("updateBlock: replaces second cell skipping the first", () => {
  const content = "# Title\n\nSome paragraph.\n";
  const result = updateBlock(content, 1, "New paragraph.\n");
  assert(result.includes("# Title"));
  assert(result.includes("New paragraph."));
  assert(!result.includes("Some paragraph."));
});

Deno.test("updateBlock: skips output: labels and output blocks, counts prose as cells", () => {
  // Cells: heading=0, snippet=1, output: label=skipped, output block=skipped, paragraph=2
  const content = [
    "# Title",
    "",
    "```js",
    "x()",
    "```",
    "",
    "output:",
    "```output",
    "result",
    "```",
    "",
    "End paragraph.",
  ].join("\n") + "\n";
  const result = updateBlock(content, 2, "Updated end.\n");
  assert(result.includes("# Title"));
  assert(result.includes("Updated end."));
  assert(!result.includes("End paragraph."));
});

Deno.test("updateBlock: handles duplicate blocks via searchFrom cursor", () => {
  const content = "Same text.\n\nSame text.\n";
  // Cell 0 = first paragraph, cell 1 = second paragraph
  const result = updateBlock(content, 1, "Different.\n");
  // First occurrence unchanged
  assert(result.includes("Same text."));
  assert(result.includes("Different."));
  // Only one "Same text." remains
  assertEquals((result.match(/Same text\./g) ?? []).length, 1);
});

Deno.test("updateBlock: unknown language code block is a cell", () => {
  const content = "```mermaid\ngraph TD\n```\n\nParagraph.\n";
  // mermaid block = cell 0, paragraph = cell 1
  const result = updateBlock(content, 1, "Updated.\n");
  assert(result.includes("mermaid"));
  assert(result.includes("Updated."));
  assert(!result.includes("Paragraph."));
});

Deno.test("updateBlock: throws if cell index not found", () => {
  const content = "Just one paragraph.\n";
  let threw = false;
  try { updateBlock(content, 5, "x"); } catch { threw = true; }
  assertEquals(threw, true);
});
```

Also add `assert` to the import line (it's used above but check if already imported):
```typescript
import { assert, assertEquals } from "@std/assert";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/writer_test.ts
```

Expected: several failures referencing `updateBlock` not exported.

- [ ] **Step 3: Implement `updateBlock` in `src/writer.ts`**

Add at the top of `src/writer.ts`, alongside existing imports:

```typescript
import { Lexer } from "marked";
```

Add this helper function (module-private) before the exports:

```typescript
function isCellExcluded(token: { type: string; lang?: string; text?: string }): boolean {
  if (token.type === "space") return true;
  if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") return true;
  if (token.type === "code" && ((token as { lang?: string }).lang ?? "").toLowerCase() === "output") return true;
  return false;
}
```

Add this export after `updateOutputBlock`:

```typescript
/**
 * Returns new markdown content with the source text of cell at `cellIndex`
 * replaced by `newMarkdown`. Cell indices are assigned sequentially to all
 * rendered tokens, excluding: space tokens, `output:` label paragraphs, and
 * ```output blocks.
 *
 * The searchFrom cursor advances past every token (including excluded ones) so
 * that duplicate blocks are resolved by position, not just text content.
 *
 * Throws if the cell index is not found.
 */
export function updateBlock(
  content: string,
  cellIndex: number,
  newMarkdown: string,
): string {
  const tokens = Lexer.lex(content);
  let cellCount = 0;
  let searchFrom = 0;

  for (const token of tokens) {
    const pos = content.indexOf(token.raw, searchFrom);
    if (pos !== -1) searchFrom = pos + token.raw.length;

    if (isCellExcluded(token)) continue;

    if (cellCount === cellIndex) {
      if (pos === -1) throw new Error(`token.raw not found in source for cell ${cellIndex}`);
      return content.slice(0, pos) + newMarkdown + content.slice(pos + token.raw.length);
    }
    cellCount++;
  }

  throw new Error(`Cell index ${cellIndex} not found`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/writer_test.ts
```

Expected: all tests pass including the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer_test.ts
git commit -m "feat: add updateBlock — replace a cell's source markdown by index"
```

---

### Task 2: Refactor `renderPage` to use shared helpers + add cell wrappers

`renderPage` currently has two inline loops: one builds the `outputMap`, one renders tokens. We extract both as helpers so `renderCellFragment` (Task 3) can reuse them without duplicating logic. Then we wrap every rendered token in a `data-cell` div.

**Files:**
- Modify: `src/markdown.ts`
- Test: `tests/markdown_test.ts`

- [ ] **Step 1: Write failing tests for cell wrappers**

Add to `tests/markdown_test.ts`:

```typescript
Deno.test("renderPage: each block gets a data-cell attribute in order", () => {
  // heading = cell 0, paragraph = cell 1, snippet = cell 2
  const md = "# Heading\n\nA paragraph.\n\n```js\nx()\n```\n";
  const html = renderPage(md, "test.md");
  assert(html.includes('data-cell="0"'));
  assert(html.includes('data-cell="1"'));
  assert(html.includes('data-cell="2"'));
  assert(!html.includes('data-cell="3"'));
});

Deno.test("renderPage: output blocks are not assigned cell indices", () => {
  // snippet = cell 0, output block = skipped, paragraph = cell 1
  const md = "```js\nx()\n```\n\n```output\nresult\n```\n\nEnd.\n";
  const html = renderPage(md, "test.md");
  assert(html.includes('data-cell="0"'));
  assert(html.includes('data-cell="1"'));
  assert(!html.includes('data-cell="2"'));
});

Deno.test("renderPage: unknown language code block gets data-cell", () => {
  const md = "```mermaid\ngraph TD\n```\n";
  const html = renderPage(md, "test.md");
  assert(html.includes('data-cell="0"'));
  assert(!html.includes('hx-post="/run"')); // still no run button
});

Deno.test("renderPage: data-raw contains the escaped source text", () => {
  const md = 'A "quoted" & paragraph.\n';
  const html = renderPage(md, "test.md");
  // Quotes and ampersands are HTML-escaped in the attribute value
  assert(html.includes('data-raw="A &quot;quoted&quot; &amp; paragraph.'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/markdown_test.ts
```

Expected: the four new tests fail (no `data-cell` attributes yet).

- [ ] **Step 3: Refactor `renderPage` in `src/markdown.ts`**

Replace the body of `src/markdown.ts` with the following. Key changes:
- `buildOutputMap` extracted as a module-private helper
- `renderTokenCell` extracted as a module-private helper (renders one token as a `<div data-cell>` wrapper)
- `renderPage` simplified to use both helpers
- `parseSnippets` and `escapeHtml` are unchanged

```typescript
// src/markdown.ts
import { Lexer, Parser, type Token, type TokensList } from "marked";
import { basename } from "@std/path";
import { KNOWN_LANGUAGES } from "./languages.ts";

export interface Snippet {
  index: number;
  lang: string;
  code: string;
}

export function parseSnippets(
  content: string,
): { snippets: Snippet[]; outputMap: Map<number, string> } {
  const tokens = Lexer.lex(content);
  const snippets: Snippet[] = [];
  const outputMap = new Map<number, string>();

  let snippetIndex = 0;
  let lastRunnableIndex: number | null = null;

  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") continue;

    if (token.type !== "code") {
      lastRunnableIndex = null;
      continue;
    }

    const lang = (token.lang ?? "").toLowerCase();

    if (lang === "output") {
      if (lastRunnableIndex !== null) {
        outputMap.set(lastRunnableIndex, token.text);
      }
      lastRunnableIndex = null;
      continue;
    }

    if (KNOWN_LANGUAGES[lang]) {
      const index = snippetIndex++;
      snippets.push({ index, lang, code: token.text });
      lastRunnableIndex = index;
    } else {
      lastRunnableIndex = null;
    }
  }

  return { snippets, outputMap };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a map from snippet index → output text from the token stream. */
function buildOutputMap(tokens: TokensList): Map<number, string> {
  const outputMap = new Map<number, string>();
  let si = 0;
  let lastRunnable: number | null = null;

  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") continue;
    if (token.type !== "code") { lastRunnable = null; continue; }

    const lang = (token.lang ?? "").toLowerCase();
    if (lang === "output") {
      if (lastRunnable !== null) outputMap.set(lastRunnable, token.text);
      lastRunnable = null;
    } else if (KNOWN_LANGUAGES[lang]) {
      lastRunnable = si++;
    } else {
      lastRunnable = null;
    }
  }

  return outputMap;
}

/**
 * Render a single token as a `<div data-cell="cellIndex" data-raw="...">` wrapper.
 * `snippetIndex` is the Run-button index (separate from cell index) — only
 * meaningful when the token is a known-language code block.
 */
function renderTokenCell(
  token: Token,
  cellIndex: number,
  snippetIndex: number,
  outputMap: Map<number, string>,
  allTokens: TokensList,
): string {
  const rawAttr = escapeHtml(token.raw);

  if (token.type === "code") {
    const lang = (token.lang ?? "").toLowerCase();
    if (KNOWN_LANGUAGES[lang]) {
      const existingOutput = outputMap.get(snippetIndex) ?? "";
      return `
<div data-cell="${cellIndex}" data-raw="${rawAttr}" class="snippet">
  <pre><code>${escapeHtml(token.text)}</code></pre>
  <button
    hx-post="/run"
    hx-vals='{"index": ${snippetIndex}}'
    hx-target="#output-${snippetIndex}"
    hx-swap="outerHTML"
    hx-indicator="#spinner-${snippetIndex}"
  >Run</button>
  <span id="spinner-${snippetIndex}" class="htmx-indicator">running…</span>
  <pre id="output-${snippetIndex}" class="output">${escapeHtml(existingOutput)}</pre>
</div>`;
    } else {
      return `<div data-cell="${cellIndex}" data-raw="${rawAttr}"><pre><code class="language-${escapeHtml(lang)}">${escapeHtml(token.text)}</code></pre></div>`;
    }
  }

  const tl = Object.assign([token as Token], { links: allTokens.links });
  return `<div data-cell="${cellIndex}" data-raw="${rawAttr}">${Parser.parse(tl)}</div>`;
}

export function renderPage(content: string, filePath: string): string {
  const tokens = Lexer.lex(content);
  const outputMap = buildOutputMap(tokens);

  let cellIndex = 0;
  let snippetIndex = 0;
  const parts: string[] = [];

  for (const token of tokens) {
    // Excluded from cell model — skip entirely
    if (token.type === "space") continue;
    if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") continue;
    if (token.type === "code" && (token.lang ?? "").toLowerCase() === "output") continue;

    parts.push(renderTokenCell(token, cellIndex, snippetIndex, outputMap, tokens));
    cellIndex++;

    // Advance snippet index only for known-language code blocks
    if (token.type === "code" && KNOWN_LANGUAGES[(token.lang ?? "").toLowerCase()]) {
      snippetIndex++;
    }
  }

  const body = parts.join("\n");
  const title = basename(filePath);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    body { max-width: 860px; margin: 0 auto; padding: 2rem 1rem; font-family: system-ui, sans-serif; line-height: 1.6; color: #1a1a1a; }
    h1, h2, h3 { margin-top: 2rem; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    code { font-family: monospace; font-size: 0.9em; }
    .snippet { margin: 1rem 0; }
    button { margin-top: 0.5rem; padding: 0.3rem 0.8rem; cursor: pointer; font-size: 0.85rem; }
    pre.output { background: #e8f5e9; border-left: 3px solid #4caf50; white-space: pre-wrap; }
    pre.output:empty { display: none; }
    pre.output:not(:empty)::before { content: "output:"; display: block; font-family: system-ui, sans-serif; font-size: 0.75em; font-weight: bold; color: #388e3c; margin-bottom: 0.4rem; }
    [data-cell] { cursor: text; border-radius: 4px; padding: 0.2rem 0.4rem; }
    [data-cell]:hover { background: #f9f9f9; outline: 1px dashed #ddd; }
    [data-cell].editing { outline: 2px solid #4f8ef7; background: #f0f6ff; }
    [data-cell].editing textarea { width: 100%; box-sizing: border-box; border: none; outline: none; background: transparent; font-family: inherit; font-size: inherit; line-height: inherit; resize: vertical; min-height: 2em; }
    .edit-hint { display: none; font-size: 0.72rem; color: #4f8ef7; text-align: right; margin-top: 0.2rem; }
    .edit-hint::after { content: "⌘↵ save  ·  Esc cancel"; }
    [data-cell].editing .edit-hint { display: block; }
  </style>
</head>
<body>
${body}
<script>
  const es = new EventSource('/events');
  es.addEventListener('change', () => location.reload());

  document.addEventListener('click', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    if (document.querySelector('[data-cell].editing')) return;
    var cell = e.target.closest('[data-cell]');
    if (!cell) return;
    startEditing(cell);
  });

  function startEditing(cell) {
    var originalHTML = cell.innerHTML;
    var raw = cell.dataset.raw;
    cell.classList.add('editing');
    cell.innerHTML = '<textarea></textarea><div class="edit-hint"></div>';
    var ta = cell.querySelector('textarea');
    ta.value = raw;
    ta.focus();
    ta.select();
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        cell.classList.remove('editing');
        cell.innerHTML = originalHTML;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveEdit(cell, ta.value);
      }
    });
  }

  function saveEdit(cell, newContent) {
    var cellIndex = cell.dataset.cell;
    var body = new URLSearchParams({ cell: cellIndex, content: newContent });
    fetch('/edit', { method: 'POST', body: body })
      .then(function(r) {
        if (!r.ok) {
          return r.text().then(function(msg) {
            var errDiv = document.createElement('div');
            errDiv.style.cssText = 'color:red;font-size:0.85em;padding:0.3rem';
            errDiv.textContent = msg;
            cell.innerHTML = '<textarea></textarea><div class="edit-hint"></div>';
            cell.insertBefore(errDiv, cell.firstChild);
            var ta = cell.querySelector('textarea');
            ta.value = newContent;
            ta.focus();
          });
        }
        return r.text().then(function(html) {
          cell.outerHTML = html;
        });
      });
  }
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run all tests**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/
```

Expected: all tests pass. The existing `renderPage` tests still pass because the HTMX attributes and output `<pre>` elements are still present inside the new wrapper divs.

- [ ] **Step 5: Commit**

```bash
git add src/markdown.ts tests/markdown_test.ts
git commit -m "feat: wrap rendered tokens in data-cell divs; extract buildOutputMap + renderTokenCell helpers"
```

---

## Chunk 2: renderCellFragment + POST /edit + client wiring

### Task 3: `renderCellFragment` in `markdown.ts`

Returns the re-rendered HTML for a single cell. Called by `POST /edit` to build its response fragment.

**Files:**
- Modify: `src/markdown.ts`
- Test: `tests/markdown_test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/markdown_test.ts`:

```typescript
import { parseSnippets, renderCellFragment, renderPage } from "../src/markdown.ts";
```

```typescript
Deno.test("renderCellFragment: returns wrapped HTML for a paragraph cell", () => {
  const md = "# Heading\n\nA paragraph.\n";
  // heading = cell 0, paragraph = cell 1
  const html = renderCellFragment(md, 1);
  assert(html.includes('data-cell="1"'));
  assert(html.includes("<p>"));
  assert(html.includes("A paragraph."));
  // Should not include the heading
  assert(!html.includes("Heading"));
});

Deno.test("renderCellFragment: returns snippet cell with correct run button index", () => {
  // heading = cell 0 (snippet index irrelevant), snippet = cell 1 (snippet index 0)
  const md = "# Heading\n\n```js\nx()\n```\n";
  const html = renderCellFragment(md, 1);
  assert(html.includes('data-cell="1"'));
  assert(html.includes('hx-post="/run"'));
  assert(html.includes('"index": 0'));
  assert(html.includes('id="output-0"'));
});

Deno.test("renderCellFragment: snippet index is independent from cell index", () => {
  // Two prose blocks before the second snippet
  // prose1=cell0, snippet1=cell1(si=0), prose2=cell2, snippet2=cell3(si=1)
  const md = "Intro.\n\n```js\na()\n```\n\nMiddle.\n\n```python\nb()\n```\n";
  const html = renderCellFragment(md, 3);
  assert(html.includes('data-cell="3"'));
  assert(html.includes('"index": 1'));
  assert(html.includes('id="output-1"'));
});

Deno.test("renderCellFragment: includes existing output in snippet cell", () => {
  const md = "```js\nx()\n```\n\n```output\nhello\n```\n";
  const html = renderCellFragment(md, 0);
  assert(html.includes("hello"));
});

Deno.test("renderCellFragment: throws for out-of-range index", () => {
  const md = "Just a paragraph.\n";
  let threw = false;
  try { renderCellFragment(md, 5); } catch { threw = true; }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/markdown_test.ts
```

Expected: failures because `renderCellFragment` is not yet exported.

- [ ] **Step 3: Add `renderCellFragment` to `src/markdown.ts`**

Add after the `renderPage` function (both share the same helpers):

```typescript
/**
 * Re-renders just the cell at `cellIndex` as a `<div data-cell="N">` fragment.
 * Walks tokens using the same exclusion rules and searchFrom cursor as updateBlock
 * so indices stay in sync across all three walking functions.
 * Throws if the cell index is not found.
 */
export function renderCellFragment(content: string, cellIndex: number): string {
  const tokens = Lexer.lex(content);
  const outputMap = buildOutputMap(tokens);

  let ci = 0;
  let si = 0;
  let searchFrom = 0;

  for (const token of tokens) {
    // Advance searchFrom for ALL tokens (including excluded) so duplicate-block
    // matching is monotonic and consistent with updateBlock.
    const pos = content.indexOf(token.raw, searchFrom);
    if (pos !== -1) searchFrom = pos + token.raw.length;

    if (token.type === "space") continue;
    if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") continue;
    if (token.type === "code" && (token.lang ?? "").toLowerCase() === "output") continue;

    if (ci === cellIndex) {
      return renderTokenCell(token, ci, si, outputMap, tokens);
    }

    ci++;
    if (token.type === "code" && KNOWN_LANGUAGES[(token.lang ?? "").toLowerCase()]) {
      si++;
    }
  }

  throw new Error(`Cell index ${cellIndex} not found`);
}
```

- [ ] **Step 4: Run all tests**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown.ts tests/markdown_test.ts
git commit -m "feat: add renderCellFragment — render a single cell as an HTML fragment"
```

---

### Task 4: `POST /edit` route in `server.ts`

Thin glue layer: validate input → `updateBlock` → write → `renderCellFragment` → return fragment.

**Files:**
- Modify: `src/server.ts`

No automated server integration tests (consistent with existing codebase). The route's logic lives in the already-tested `updateBlock` and `renderCellFragment`. Manual smoke test instructions below.

- [ ] **Step 1: Add imports to `src/server.ts`**

The new route needs `updateBlock` and `renderCellFragment`. Add to the existing imports at the top:

```typescript
import { updateBlock, updateOutputBlock, writeOutput } from "./writer.ts";
import { parseSnippets, renderCellFragment, renderPage } from "./markdown.ts";
```

(Replace the current import lines for `writer.ts` and `markdown.ts`.)

- [ ] **Step 2: Add the `POST /edit` route to `src/server.ts`**

Add after the `POST /run` handler (before `GET /events`):

```typescript
  // POST /edit — update a cell's source markdown, return re-rendered fragment
  app.post("/edit", async (c) => {
    const form = await c.req.formData();
    const cellStr = form.get("cell");
    const newContent = form.get("content");

    if (cellStr === null || typeof cellStr !== "string") return c.text("Missing cell", 400);
    if (newContent === null || typeof newContent !== "string") return c.text("Missing content", 400);

    const cellIndex = parseInt(cellStr, 10);
    if (isNaN(cellIndex)) return c.text("Invalid cell index", 400);

    try {
      const content = await Deno.readTextFile(filePath);
      const updated = updateBlock(content, cellIndex, newContent);
      watcher.suppress();
      await writeOutput(filePath, updated);
      const fragment = renderCellFragment(updated, cellIndex);
      return c.html(fragment);
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) {
        return c.text(`Error: ${e.message}`, 400);
      }
      console.error("Failed to write edit:", e);
      return c.text("Error: could not save edit", 500);
    }
  });
```

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
deno test --allow-read --allow-write --allow-net --allow-run=deno,python3,bash,sh,ruby tests/
```

Expected: all tests pass (no server integration tests, but existing unit tests must stay green).

- [ ] **Step 4: Manual smoke test**

```bash
deno run --allow-read --allow-write --allow-net --allow-run src/main.ts README.md --no-open
```

In a second terminal:
```bash
# Get the current cell 0 content (the first rendered block in README.md)
# Then send an edit — this should replace cell 0 and return its re-rendered HTML
curl -s -X POST http://localhost:7700/edit \
  -d "cell=0&content=%23%20rundown%0A" \
  | grep 'data-cell="0"'
```

Expected: the response contains `data-cell="0"` and the updated content.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add POST /edit route — update cell source and return re-rendered fragment"
```

---

### Task 5: Verify client-side interaction end-to-end

The client-side JS and CSS were added in Task 2 as part of the `renderPage` template. This task is a structured manual verification with no code changes needed unless bugs are found.

- [ ] **Step 1: Start the dev server**

```bash
deno run --allow-read --allow-write --allow-net --allow-run src/main.ts README.md
```

This should open `http://localhost:7700` in your browser.

- [ ] **Step 2: Verify hover state**

Hover over any heading, paragraph, or code block. Expected: subtle dashed border + light background tint appears. No visible change when hovering the Run button.

- [ ] **Step 3: Verify click-to-edit**

Click on a paragraph. Expected:
- Blue border appears around the cell
- Content is replaced by a textarea pre-filled with the raw markdown source
- `⌘↵ save · Esc cancel` hint appears below the textarea

- [ ] **Step 4: Verify Escape cancels**

While editing a cell, press Escape. Expected: textarea disappears, original rendered content is restored, no file change.

- [ ] **Step 5: Verify save with Cmd/Ctrl+Enter**

Click a paragraph to edit it. Change the text. Press `Cmd+Enter` (macOS) or `Ctrl+Enter` (Linux/Windows). Expected:
- Textarea disappears
- Cell re-renders with the new content
- The source `.md` file on disk is updated (check with `cat README.md` or observe the file in your editor)

- [ ] **Step 6: Verify Run button still works**

Click Run on any code snippet. Expected: run executes normally, output appears. Editing a snippet cell and then running it should use the updated code.

- [ ] **Step 7: Verify only one cell editable at a time**

Click to edit a cell. While it's open, click a different cell. Expected: nothing happens — the second click is ignored while one cell is already being edited.

- [ ] **Step 8: Final commit**

If any bugs required code changes in steps 1–7, commit those fixes now. If no changes were needed:

```bash
git log --oneline -5
```

No additional commit needed.

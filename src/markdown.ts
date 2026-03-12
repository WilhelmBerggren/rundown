// src/markdown.ts
import { Lexer, Parser, type Token, type TokensList } from "marked";
import { basename } from "@std/path";
import { KNOWN_LANGUAGES } from "./languages.ts";

export interface Snippet {
  index: number;
  lang: string;
  code: string;
}

export function parseSnippets(content: string): {
  snippets: Snippet[];
  outputMap: Map<number, string>;
} {
  const tokens = Lexer.lex(content);
  const snippets: Snippet[] = [];
  const outputMap = new Map<number, string>();

  let snippetIndex = 0;
  let lastRunnableIndex: number | null = null;

  for (const token of tokens) {
    if (token.type === "space") continue;
    if (
      token.type === "paragraph" &&
      (token as { text: string }).text.trim() === "output:"
    )
      continue;

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

/** Count the non-excluded cells that a markdown string would produce. */
export function countNewCells(markdown: string): number {
  const tokens = Lexer.lex(markdown);
  let count = 0;
  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") continue;
    if (token.type === "code" && (token.lang ?? "").toLowerCase() === "output") continue;
    count++;
  }
  return count;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

/** Build a map from snippet index → output text from the token stream. */
function buildOutputMap(tokens: TokensList): Map<number, string> {
  const outputMap = new Map<number, string>();
  let si = 0;
  let lastRunnable: number | null = null;

  for (const token of tokens) {
    if (token.type === "space") continue;
    if (
      token.type === "paragraph" &&
      (token as { text: string }).text.trim() === "output:"
    )
      continue;
    if (token.type !== "code") {
      lastRunnable = null;
      continue;
    }

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
    if (
      token.type === "paragraph" &&
      (token as { text: string }).text.trim() === "output:"
    )
      continue;
    if (token.type === "code" && (token.lang ?? "").toLowerCase() === "output")
      continue;

    if (ci === cellIndex) {
      return renderTokenCell(token, ci, si, outputMap, tokens);
    }

    ci++;
    if (
      token.type === "code" &&
      KNOWN_LANGUAGES[(token.lang ?? "").toLowerCase()]
    ) {
      si++;
    }
  }

  throw new Error(`Cell index ${cellIndex} not found`);
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
    if (
      token.type === "paragraph" &&
      (token as { text: string }).text.trim() === "output:"
    )
      continue;
    if (token.type === "code" && (token.lang ?? "").toLowerCase() === "output")
      continue;

    parts.push(
      renderTokenCell(token, cellIndex, snippetIndex, outputMap, tokens),
    );
    cellIndex++;

    // Advance snippet index only for known-language code blocks
    if (
      token.type === "code" &&
      KNOWN_LANGUAGES[(token.lang ?? "").toLowerCase()]
    ) {
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
    var trailingNl = (raw.match(/\\n+$/) || [''])[0];
    cell.classList.add('editing');
    cell.innerHTML = '<textarea></textarea><div class="edit-hint"></div>';
    var ta = cell.querySelector('textarea');
    ta.value = raw.slice(0, raw.length - trailingNl.length);
    ta.focus();
    ta.select();
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        cell.classList.remove('editing');
        cell.innerHTML = originalHTML;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveEdit(cell, ta.value + trailingNl);
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
          var tmp = document.createElement('template');
          tmp.innerHTML = html;
          var newCells = Array.from(tmp.content.children);
          var delta = newCells.length - 1;
          cell.replaceWith.apply(cell, newCells);
          newCells.forEach(function(nc) { htmx.process(nc); });
          if (delta !== 0) {
            var lastNew = newCells[newCells.length - 1];
            var sib = lastNew ? lastNew.nextElementSibling : null;
            while (sib) {
              if (sib.dataset && sib.dataset.cell !== undefined) {
                sib.dataset.cell = String(parseInt(sib.dataset.cell) + delta);
              }
              sib = sib.nextElementSibling;
            }
          }
        });
      });
  }
</script>
</body>
</html>`;
}

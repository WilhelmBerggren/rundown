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
  // Index of the last runnable snippet with no breaking token after it
  let lastRunnableIndex: number | null = null;

  for (const token of tokens) {
    // Blank lines preserve association
    if (token.type === "space") continue;

    if (token.type !== "code") {
      // Any non-blank, non-code token breaks association
      lastRunnableIndex = null;
      continue;
    }

    const lang = (token.lang ?? "").toLowerCase();

    if (lang === "output") {
      if (lastRunnableIndex !== null) {
        outputMap.set(lastRunnableIndex, token.text);
      }
      // output block itself breaks further chaining
      lastRunnableIndex = null;
      continue;
    }

    if (KNOWN_LANGUAGES[lang]) {
      const index = snippetIndex++;
      snippets.push({ index, lang, code: token.text });
      lastRunnableIndex = index;
    } else {
      // Unknown language code block breaks association
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

export function renderPage(content: string, filePath: string): string {
  // Single lex — both the outputMap and the HTML walk the same token array,
  // guaranteeing snippet indices are always in sync.
  const tokens = Lexer.lex(content);

  // Build outputMap (same logic as parseSnippets)
  const outputMap = new Map<number, string>();
  let si = 0;
  let lastRunnable: number | null = null;
  for (const token of tokens) {
    if (token.type === "space") continue;
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

  // Render HTML — walk tokens, handle code tokens manually
  let snippetIndex = 0;
  const parts: string[] = [];

  for (const token of tokens) {
    if (token.type === "code") {
      const lang = (token.lang ?? "").toLowerCase();
      if (lang === "output") continue; // suppressed — rendered with its snippet
      if (KNOWN_LANGUAGES[lang]) {
        const index = snippetIndex++;
        const existingOutput = outputMap.get(index) ?? "";
        parts.push(`
<div class="snippet">
  <pre><code>${escapeHtml(token.text)}</code></pre>
  <button
    hx-post="/run"
    hx-vals='{"index": ${index}}'
    hx-target="#output-${index}"
    hx-swap="outerHTML"
    hx-indicator="#spinner-${index}"
  >Run</button>
  <span id="spinner-${index}" class="htmx-indicator">running…</span>
  <pre id="output-${index}" class="output">${escapeHtml(existingOutput)}</pre>
</div>`);
      } else {
        parts.push(`<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(token.text)}</code></pre>`);
      }
    } else {
      // Let marked render all other tokens (headings, paragraphs, lists, etc.)
      // Parser.parse requires a TokensList (Token[] with a `links` property).
      const tl = Object.assign([token as Token], { links: (tokens as TokensList).links });
      parts.push(Parser.parse(tl));
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
  </style>
</head>
<body>
${body}
<script>
  const es = new EventSource('/events');
  es.addEventListener('change', () => location.reload());
</script>
</body>
</html>`;
}

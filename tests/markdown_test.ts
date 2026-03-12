// tests/markdown_test.ts
import { assert, assertEquals } from "@std/assert";
import { parseSnippets, renderPage } from "../src/markdown.ts";

Deno.test("parseSnippets: assigns sequential indices to runnable snippets", () => {
  const md = [
    "```js",
    "console.log(1);",
    "```",
    "",
    "```python",
    "print(2)",
    "```",
  ].join("\n");

  const { snippets } = parseSnippets(md);
  assertEquals(snippets.length, 2);
  assertEquals(snippets[0].index, 0);
  assertEquals(snippets[0].lang, "js");
  assertEquals(snippets[0].code, "console.log(1);");
  assertEquals(snippets[1].index, 1);
  assertEquals(snippets[1].lang, "python");
});

Deno.test("parseSnippets: unknown language not included in snippets", () => {
  const md = ["```mermaid", "graph TD", "```"].join("\n");
  const { snippets } = parseSnippets(md);
  assertEquals(snippets.length, 0);
});

Deno.test("parseSnippets: output block associated with preceding snippet", () => {
  const md = [
    "```js",
    "console.log(1 + 1);",
    "```",
    "",
    "```output",
    "2",
    "```",
  ].join("\n");

  const { snippets, outputMap } = parseSnippets(md);
  assertEquals(snippets.length, 1);
  assertEquals(outputMap.get(0), "2");
});

Deno.test("parseSnippets: output block not associated if intervening content", () => {
  const md = [
    "```js",
    "console.log(1);",
    "```",
    "",
    "Some text",
    "",
    "```output",
    "1",
    "```",
  ].join("\n");

  const { outputMap } = parseSnippets(md);
  assertEquals(outputMap.get(0), undefined);
});

Deno.test("parseSnippets: output block not associated if intervening code block", () => {
  const md = [
    "```js",
    "console.log(1);",
    "```",
    "",
    "```python",
    "print(2)",
    "```",
    "",
    "```output",
    "2",
    "```",
  ].join("\n");

  const { outputMap } = parseSnippets(md);
  // output block follows python snippet (index 1), not js snippet (index 0)
  assertEquals(outputMap.get(0), undefined);
  assertEquals(outputMap.get(1), "2");
});

Deno.test("parseSnippets: output blocks excluded from snippet index sequence", () => {
  const md = [
    "```js",
    "a()",
    "```",
    "",
    "```output",
    "result",
    "```",
    "",
    "```js",
    "b()",
    "```",
  ].join("\n");

  const { snippets } = parseSnippets(md);
  assertEquals(snippets.length, 2);
  assertEquals(snippets[0].index, 0);
  assertEquals(snippets[1].index, 1);
});

Deno.test("renderPage: runnable snippet gets run button with correct index", () => {
  const md = ["```js", "console.log(1);", "```"].join("\n");
  const html = renderPage(md, "test.md");
  // HTMX attributes present
  assert(html.includes('hx-post="/run"'));
  assert(html.includes('"index": 0'));
  assert(html.includes('id="output-0"'));
  // Run button present
  assert(html.includes(">Run<"));
});

Deno.test("renderPage: unknown language has no run button", () => {
  const md = ["```mermaid", "graph TD", "```"].join("\n");
  const html = renderPage(md, "test.md");
  assert(!html.includes('hx-post="/run"'));
});

Deno.test("renderPage: existing output block rendered in pre element", () => {
  const md = [
    "```js",
    "console.log(42);",
    "```",
    "",
    "```output",
    "42",
    "```",
  ].join("\n");
  const html = renderPage(md, "test.md");
  assert(html.includes('id="output-0"'));
  assert(html.includes("42"));
  // The output code block should NOT appear as a separate element
  const outputPreCount = (html.match(/id="output-0"/g) ?? []).length;
  assertEquals(outputPreCount, 1);
});

Deno.test("renderPage: empty output pre always rendered for first-run target", () => {
  const md = ["```python", "print('hi')", "```"].join("\n");
  const html = renderPage(md, "test.md");
  assert(html.includes('id="output-0"'));
});

Deno.test("renderPage: includes HTMX script tag", () => {
  const html = renderPage("# Hello", "test.md");
  assert(html.includes("htmx.org"));
});

Deno.test("renderPage: includes SSE listener script", () => {
  const html = renderPage("# Hello", "test.md");
  assert(html.includes("EventSource"));
  assert(html.includes("/events"));
});

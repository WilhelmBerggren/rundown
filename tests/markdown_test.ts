// tests/markdown_test.ts
import { assert, assertEquals } from "@std/assert";
import { parseSnippets, renderCellFragment, renderPage } from "../src/markdown.ts";

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

Deno.test("renderPage: data-raw encodes newlines as &#10; for attribute safety", () => {
  const md = "```js\nx()\n```\n";
  const html = renderPage(md, "test.md");
  // Newlines in token.raw must be encoded as &#10; so dataset.raw round-trips correctly
  assert(html.includes('data-raw="```js&#10;x()&#10;```&#10;"'));
});

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

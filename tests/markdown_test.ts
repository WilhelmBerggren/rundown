// tests/markdown_test.ts
import { assert, assertEquals } from "@std/assert";
import { parseSnippets } from "../src/markdown.ts";

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

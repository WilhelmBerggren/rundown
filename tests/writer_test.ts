// tests/writer_test.ts
import { assertEquals } from "@std/assert";
import { updateOutputBlock } from "../src/writer.ts";

Deno.test("updateOutputBlock: inserts output block after snippet", () => {
  const content = ["```js", "console.log(1);", "```", "", "Some text"].join("\n");
  const result = updateOutputBlock(content, 0, "1");
  const lines = result.split("\n");
  // Find the closing fence of the snippet
  const closeFenceIdx = lines.indexOf("```", 1); // second ``` occurrence
  assertEquals(lines[closeFenceIdx + 1], "");       // blank line
  assertEquals(lines[closeFenceIdx + 2], "```output");
  assertEquals(lines[closeFenceIdx + 3], "1");
  assertEquals(lines[closeFenceIdx + 4], "```");
});

Deno.test("updateOutputBlock: replaces existing output block", () => {
  const content = [
    "```js",
    "console.log(1 + 1);",
    "```",
    "",
    "```output",
    "old result",
    "```",
  ].join("\n");
  const result = updateOutputBlock(content, 0, "2");
  assertEquals(result.includes("old result"), false);
  assertEquals(result.includes("```output\n2\n```"), true);
});

Deno.test("updateOutputBlock: targets correct snippet by index", () => {
  const content = [
    "```js",
    "a()",
    "```",
    "",
    "```python",
    "b()",
    "```",
  ].join("\n");
  const result = updateOutputBlock(content, 1, "b output");
  assertEquals(result.includes("b output"), true);
  // First snippet has no output block
  assertEquals(result.split("```output").length, 2); // only one output block
});

Deno.test("updateOutputBlock: multi-line output preserved", () => {
  const content = ["```sh", "ls", "```"].join("\n");
  const result = updateOutputBlock(content, 0, "file1.txt\nfile2.txt");
  assertEquals(result.includes("file1.txt\nfile2.txt"), true);
});

Deno.test("updateOutputBlock: throws if snippet index not found", () => {
  const content = ["```js", "a()", "```"].join("\n");
  let threw = false;
  try {
    updateOutputBlock(content, 5, "x");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

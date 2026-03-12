// tests/writer_test.ts
import { assert, assertEquals } from "@std/assert";
import { removeOutputBlock, updateBlock, updateOutputBlock } from "../src/writer.ts";

Deno.test("updateOutputBlock: inserts output block after snippet", () => {
  const content = ["```js", "console.log(1);", "```", "", "Some text"].join("\n");
  const result = updateOutputBlock(content, 0, "1");
  const lines = result.split("\n");
  // Find the closing fence of the snippet
  const closeFenceIdx = lines.indexOf("```", 1); // second ``` occurrence
  assertEquals(lines[closeFenceIdx + 1], "");         // blank line
  assertEquals(lines[closeFenceIdx + 2], "output:");  // label
  assertEquals(lines[closeFenceIdx + 3], "```output");
  assertEquals(lines[closeFenceIdx + 4], "1");
  assertEquals(lines[closeFenceIdx + 5], "```");
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

Deno.test("removeOutputBlock: removes output block and label", () => {
  const content = [
    "```js",
    "a()",
    "```",
    "",
    "output:",
    "```output",
    "result",
    "```",
    "",
    "End.",
  ].join("\n") + "\n";
  const result = removeOutputBlock(content, 0);
  assert(!result.includes("result"));
  assert(!result.includes("```output"));
  assert(!result.includes("output:"));
  assert(result.includes("a()"));
  assert(result.includes("End."));
});

Deno.test("removeOutputBlock: returns content unchanged when no output block", () => {
  const content = ["```js", "a()", "```"].join("\n");
  assertEquals(removeOutputBlock(content, 0), content);
});

Deno.test("removeOutputBlock: targets correct snippet by index", () => {
  const content = [
    "```js",
    "a()",
    "```",
    "",
    "```js",
    "b()",
    "```",
    "",
    "output:",
    "```output",
    "b result",
    "```",
  ].join("\n");
  const result = removeOutputBlock(content, 1);
  assert(!result.includes("b result"));
  assert(result.includes("a()"));
  assert(result.includes("b()"));
});

Deno.test("updateBlock: throws if cell index not found", () => {
  const content = "Just one paragraph.\n";
  let threw = false;
  try { updateBlock(content, 5, "x"); } catch { threw = true; }
  assertEquals(threw, true);
});

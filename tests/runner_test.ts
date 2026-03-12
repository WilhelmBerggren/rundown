// tests/runner_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { runSnippet } from "../src/runner.ts";

Deno.test("runSnippet: runs a js snippet and returns stdout", async () => {
  const result = await runSnippet("js", "console.log('hello');");
  assertEquals(result.timedOut, false);
  assertStringIncludes(result.output, "hello");
});

Deno.test("runSnippet: captures stderr in output", async () => {
  const result = await runSnippet("js", "console.error('err msg');");
  assertEquals(result.timedOut, false);
  assertStringIncludes(result.output, "err msg");
});

Deno.test("runSnippet: non-zero exit code captured in result", async () => {
  const result = await runSnippet("sh", "exit 1");
  assertEquals(result.exitCode, 1);
});

Deno.test("runSnippet: notFound is false when interpreter exists", async () => {
  const result = await runSnippet("sh", "echo hi");
  assertEquals(result.notFound, false);
});

Deno.test("runSnippet: notFound result shape is correct regardless of ruby presence", async () => {
  // ruby maps to the "ruby" interpreter; if not installed, we get notFound=true
  const result = await runSnippet("ruby", "puts 'hi'");
  if (result.notFound) {
    // ruby not installed — verify ENOENT result shape
    assertEquals(result.exitCode, -1);
    assertEquals(result.timedOut, false);
    assertEquals(result.output, "");
  } else {
    // ruby is installed — verify it ran successfully
    assertStringIncludes(result.output, "hi");
  }
});

Deno.test("runSnippet: python snippet runs correctly", async () => {
  const result = await runSnippet("python", "print(1 + 1)");
  assertStringIncludes(result.output, "2");
});

// src/server.ts
import { Hono } from "hono";
import { countNewCells, parseSnippets, renderCellFragment, renderPage } from "./markdown.ts";
import { runSnippet } from "./runner.ts";
import { removeOutputBlock, updateBlock, updateOutputBlock, writeOutput } from "./writer.ts";
import { createWatcher, type Watcher } from "./watcher.ts";

function outputFragment(index: number, text: string, isError = false): string {
  const cls = isError ? ' class="output error"' : ' class="output"';
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre id="output-${index}"${cls}>${escaped}</pre>`;
}

export function createApp(filePath: string) {
  const app = new Hono();
  const watcher: Watcher = createWatcher(filePath);

  // Per-file run mutex: a promise that resolves when the current run finishes
  let runLock: Promise<void> | null = null;

  // GET / — render full page
  app.get("/", async (c) => {
    let content: string;
    try {
      content = await Deno.readTextFile(filePath);
    } catch {
      return c.text("Error: could not read file", 500);
    }
    return c.html(renderPage(content, filePath));
  });

  // POST /run — execute snippet, write output, return fragment
  app.post("/run", async (c) => {
    // Parse form data first so we have index for error fragments
    const form = await c.req.formData();
    const indexStr = form.get("index");
    if (indexStr === null) return c.text("Missing index", 400);
    const index = parseInt(String(indexStr), 10);
    if (isNaN(index)) return c.text("Invalid index", 400);

    // Reject if a run is already in progress
    if (runLock) {
      return c.html(outputFragment(index, "Error: a run is already in progress", true), 429);
    }

    let resolveLock!: () => void;
    runLock = new Promise<void>((resolve) => { resolveLock = resolve; });

    try {
      // Re-read file at execution time
      const content = await Deno.readTextFile(filePath);
      const { snippets } = parseSnippets(content);
      const snippet = snippets[index];

      if (!snippet) {
        return c.html(outputFragment(index, `Error: snippet ${index} not found`, true));
      }

      const result = await runSnippet(snippet.lang, snippet.code);

      let outputText: string;
      if (result.notFound) {
        outputText = `Error: ${snippet.lang} interpreter not found`;
      } else if (result.timedOut) {
        outputText = "Error: timed out after 30s";
      } else {
        outputText = result.output;
      }

      const isError = result.notFound || result.timedOut;

      // Write output back to file
      try {
        const freshContent = await Deno.readTextFile(filePath);
        const updated = updateOutputBlock(freshContent, index, outputText);
        watcher.suppress();
        await writeOutput(filePath, updated);
      } catch (e) {
        console.error("Failed to write output:", e);
        // Still return output to browser even if file write fails
      }

      return c.html(outputFragment(index, outputText, isError));
    } finally {
      runLock = null;
      resolveLock();
    }
  });

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
      const normalized = /^`{3,}[\w-]*\n/.test(newContent)
        ? newContent.replace(/\n{3,}/g, "\n\n")
        : newContent;
      const updated = updateBlock(content, cellIndex, normalized);
      watcher.suppress();
      await writeOutput(filePath, updated);
      const k = countNewCells(normalized);
      const fragments = Array.from({ length: k }, (_, i) =>
        renderCellFragment(updated, cellIndex + i)
      ).join("");
      return c.html(fragments);
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) {
        return c.text(`Error: ${e.message}`, 400);
      }
      console.error("Failed to write edit:", e);
      return c.text("Error: could not save edit", 500);
    }
  });

  // POST /clear — remove output block for a snippet, return empty output pre
  app.post("/clear", async (c) => {
    const form = await c.req.formData();
    const indexStr = form.get("index");
    if (indexStr === null) return c.text("Missing index", 400);
    const index = parseInt(String(indexStr), 10);
    if (isNaN(index)) return c.text("Invalid index", 400);

    const content = await Deno.readTextFile(filePath);
    const updated = removeOutputBlock(content, index);
    watcher.suppress();
    await writeOutput(filePath, updated);
    return c.html(outputFragment(index, ""));
  });

  // GET /events — SSE for file-change reload
  app.get("/events", (c) => {
    let streamController: ReadableStreamDefaultController | null = null;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        watcher.addClient(controller);
        // Send a comment to keep the connection alive
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel() {
        if (streamController) watcher.removeClient(streamController);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return { app, watcher };
}

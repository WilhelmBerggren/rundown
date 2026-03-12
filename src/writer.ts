// src/writer.ts
import { KNOWN_LANGUAGES } from "./languages.ts";

/**
 * Returns new markdown content with the output block for snippet at
 * `snippetIndex` added (if none exists) or replaced (if one exists).
 * Throws if the snippet index is not found.
 */
export function updateOutputBlock(
  content: string,
  snippetIndex: number,
  output: string,
): string {
  const lines = content.split("\n");
  let runnableCount = 0;
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^(`{3,})([\w-]*)/);

    if (!fenceMatch) {
      i++;
      continue;
    }

    const fence = fenceMatch[1];
    const lang = fenceMatch[2].toLowerCase();

    // Skip output blocks
    if (lang === "output") {
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) i++;
      i++;
      continue;
    }

    // Find the closing fence of this code block
    i++;
    while (i < lines.length && !lines[i].startsWith(fence)) i++;
    const closeLine = i;
    i++;

    if (!KNOWN_LANGUAGES[lang]) continue; // unknown language — skip

    if (runnableCount !== snippetIndex) {
      runnableCount++;
      continue;
    }

    // Found target snippet. Look ahead for an associated output block.
    let j = i;
    while (j < lines.length && lines[j].trim() === "") j++;

    const outputFenceMatch = j < lines.length
      ? lines[j].match(/^(`{3,})output\b/)
      : null;

    const newOutputBlock = ["```output", ...output.split("\n"), "```"];

    if (outputFenceMatch) {
      // Replace existing output block
      const outputFence = outputFenceMatch[1];
      const outputStart = j;
      j++;
      while (j < lines.length && !lines[j].startsWith(outputFence)) j++;
      const outputEnd = j; // index of closing fence

      lines.splice(outputStart, outputEnd - outputStart + 1, ...newOutputBlock);
    } else {
      // Insert after closeLine: blank line + output block
      lines.splice(closeLine + 1, 0, "", ...newOutputBlock);
    }

    return lines.join("\n");
  }

  throw new Error(`Snippet index ${snippetIndex} not found`);
}

/**
 * Atomically writes content to filePath via a temp file + rename.
 */
export async function writeOutput(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await Deno.writeTextFile(tmpPath, content);
  await Deno.rename(tmpPath, filePath);
}

// src/writer.ts
import { Lexer } from "marked";
import { KNOWN_LANGUAGES } from "./languages.ts";

function isCellExcluded(token: { type: string; lang?: string; text?: string }): boolean {
  if (token.type === "space") return true;
  if (token.type === "paragraph" && (token as { text: string }).text.trim() === "output:") return true;
  if (token.type === "code" && ((token as { lang?: string }).lang ?? "").toLowerCase() === "output") return true;
  return false;
}

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

    // Track "output:" label line so it's included in replacements
    let outputLabelLine: number | null = null;
    if (j < lines.length && lines[j].trim() === "output:") {
      outputLabelLine = j;
      j++;
      while (j < lines.length && lines[j].trim() === "") j++;
    }

    const outputFenceMatch = j < lines.length
      ? lines[j].match(/^(`{3,})output\b/)
      : null;

    const newOutputBlock = ["output:", "```output", ...output.split("\n"), "```"];

    if (outputFenceMatch) {
      // Replace existing output block (and its label if present)
      const outputFence = outputFenceMatch[1];
      const replaceFrom = outputLabelLine ?? j;
      j++;
      while (j < lines.length && !lines[j].startsWith(outputFence)) j++;
      const outputEnd = j; // index of closing fence

      lines.splice(replaceFrom, outputEnd - replaceFrom + 1, ...newOutputBlock);
    } else {
      // Insert after closeLine: blank line + label + output block
      lines.splice(closeLine + 1, 0, "", ...newOutputBlock);
    }

    return lines.join("\n");
  }

  throw new Error(`Snippet index ${snippetIndex} not found`);
}

/**
 * Returns new markdown content with the source text of cell at `cellIndex`
 * replaced by `newMarkdown`. Cell indices are assigned sequentially to all
 * rendered tokens, excluding: space tokens, `output:` label paragraphs, and
 * ```output blocks.
 *
 * The searchFrom cursor advances past every token (including excluded ones) so
 * that duplicate blocks are resolved by position, not just text content.
 *
 * Throws if the cell index is not found.
 */
export function updateBlock(
  content: string,
  cellIndex: number,
  newMarkdown: string,
): string {
  const tokens = Lexer.lex(content);
  let cellCount = 0;
  let searchFrom = 0;

  for (const token of tokens) {
    const pos = content.indexOf(token.raw, searchFrom);
    if (pos !== -1) searchFrom = pos + token.raw.length;

    if (isCellExcluded(token)) continue;

    if (cellCount === cellIndex) {
      if (pos === -1) throw new Error(`token.raw not found in source for cell ${cellIndex}`);
      return content.slice(0, pos) + newMarkdown + content.slice(pos + token.raw.length);
    }
    cellCount++;
  }

  throw new Error(`Cell index ${cellIndex} not found`);
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

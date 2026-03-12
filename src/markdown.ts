// src/markdown.ts
import { Lexer } from "marked";
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

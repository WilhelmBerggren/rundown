// src/languages.ts

export interface LangConfig {
  ext: string;
  interpreter: string;
}

export const KNOWN_LANGUAGES: Record<string, LangConfig> = {
  js:         { ext: ".js", interpreter: "deno" },
  javascript: { ext: ".js", interpreter: "deno" },
  ts:         { ext: ".ts", interpreter: "deno" },
  typescript: { ext: ".ts", interpreter: "deno" },
  python:     { ext: ".py", interpreter: "python3" },
  py:         { ext: ".py", interpreter: "python3" },
  bash:       { ext: ".sh", interpreter: "bash" },
  sh:         { ext: ".sh", interpreter: "sh" },
  ruby:       { ext: ".rb", interpreter: "ruby" },
};

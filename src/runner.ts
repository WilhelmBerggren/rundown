// src/runner.ts
import { KNOWN_LANGUAGES } from "./languages.ts";

const TIMEOUT_MS = 30_000;

export interface RunResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  notFound: boolean;
}

export async function runSnippet(lang: string, code: string): Promise<RunResult> {
  const config = KNOWN_LANGUAGES[lang.toLowerCase()];
  if (!config) throw new Error(`Unsupported language: ${lang}`);

  const tmpFile = await Deno.makeTempFile({ suffix: config.ext });

  try {
    await Deno.writeTextFile(tmpFile, code);

    const cmd = new Deno.Command(config.interpreter, {
      args: [tmpFile],
      stdout: "piped",
      stderr: "piped",
    });

    let process: Deno.ChildProcess;
    try {
      process = cmd.spawn();
    } catch (e) {
      // Deno throws Deno.errors.NotFound when the executable is not on PATH
      if (e instanceof Deno.errors.NotFound) {
        return { output: "", exitCode: -1, timedOut: false, notFound: true };
      }
      throw e;
    }

    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      try { process.kill("SIGKILL"); } catch { /* already exited */ }
    }, TIMEOUT_MS);

    let exitCode: number;
    let stdout: Uint8Array;
    let stderr: Uint8Array;

    try {
      ({ code: exitCode, stdout, stderr } = await process.output());
    } finally {
      clearTimeout(killTimer);
    }

    const out = new TextDecoder().decode(stdout);
    const err = new TextDecoder().decode(stderr);
    // Strip ANSI escape codes so output stored in the markdown file is plain text
    const combined = (out + err).trimEnd().replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
      "",
    );

    return { output: combined, exitCode, timedOut, notFound: false };
  } finally {
    await Deno.remove(tmpFile).catch(() => {});
  }
}

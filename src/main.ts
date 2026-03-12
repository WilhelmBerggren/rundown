// src/main.ts
import { createApp } from "./server.ts";

function printUsage() {
  console.error("Usage: rundoc <file.md> [--port <port>] [--no-open]");
}

function parseArgs(args: string[]): { file: string; port: number; open: boolean } | null {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") {
      i++; // skip the port value
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1) {
    printUsage();
    return null;
  }
  const file = positional[0];
  let port = 7700;
  let open = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--no-open") open = false;
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      if (isNaN(port)) {
        console.error("Error: --port must be a number");
        return null;
      }
    }
  }

  return { file, port, open };
}

async function main() {
  const parsed = parseArgs(Deno.args.slice(0));
  if (!parsed) Deno.exit(1);

  const { file, port, open } = parsed;

  // Validate file exists and is readable
  try {
    await Deno.stat(file);
  } catch {
    console.error(`Error: cannot read file "${file}"`);
    Deno.exit(1);
  }

  const { app, watcher } = createApp(file);

  const ac = new AbortController();
  const server = Deno.serve({ port, signal: ac.signal, onListen: () => {} }, app.fetch);
  console.log(`rundoc running at http://localhost:${port}`);

  if (open) {
    const url = `http://localhost:${port}`;
    if (Deno.build.os === "darwin") {
      new Deno.Command("open", { args: [url] }).spawn();
    } else if (Deno.build.os === "windows") {
      // "start" is a cmd.exe built-in, not a standalone executable
      new Deno.Command("cmd", { args: ["/c", "start", url] }).spawn();
    } else {
      new Deno.Command("xdg-open", { args: [url] }).spawn();
    }
  }

  // Graceful shutdown on SIGINT (Ctrl+C)
  Deno.addSignalListener("SIGINT", () => {
    watcher.stop();
    ac.abort();
  });

  await server.finished;
}

main();

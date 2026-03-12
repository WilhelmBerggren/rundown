// src/watcher.ts

export interface Watcher {
  /** Call before writing the file from a run, to suppress the resulting watchFs event. */
  suppress(): void;
  /** Register an SSE response stream to receive "change" events. */
  addClient(controller: ReadableStreamDefaultController): void;
  /** Remove an SSE client when they disconnect. */
  removeClient(controller: ReadableStreamDefaultController): void;
  /** Stop the watcher. */
  stop(): void;
}

export function createWatcher(filePath: string): Watcher {
  const clients = new Set<ReadableStreamDefaultController>();
  let lastRunWriteAt = 0;
  let stopped = false;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function broadcast() {
    const data = `event: change\ndata: {}\n\n`;
    for (const ctrl of clients) {
      try {
        ctrl.enqueue(new TextEncoder().encode(data));
      } catch {
        clients.delete(ctrl);
      }
    }
  }

  let fsWatcher: Deno.FsWatcher | null = null;

  async function watch() {
    fsWatcher = Deno.watchFs(filePath);
    for await (const event of fsWatcher) {
      if (stopped) break;
      if (!["modify", "rename"].includes(event.kind)) continue;

      // Suppress events caused by our own atomic write
      if (Date.now() - lastRunWriteAt < 500) continue;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(broadcast, 100);
    }
  }

  watch(); // fire-and-forget background loop

  return {
    suppress() {
      lastRunWriteAt = Date.now();
    },
    addClient(ctrl) {
      clients.add(ctrl);
    },
    removeClient(ctrl) {
      clients.delete(ctrl);
    },
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      fsWatcher?.close(); // immediately terminates the for-await loop
    },
  };
}

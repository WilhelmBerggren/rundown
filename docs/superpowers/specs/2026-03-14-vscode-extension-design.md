# rundown VS Code Extension — Design

**Date:** 2026-03-14

A VS Code extension that brings the rundown experience (markdown with runnable shell code cells, output persisted inline) to VS Code via the native Notebook API.

---

## Goals

- Open any `.md` file as a rundown notebook via an opt-in command
- Render markdown prose as text cells and `sh`/`bash` fences as executable code cells
- Run shell cells; capture output and persist it back to the `.md` file as ` ```output ``` ` fences
- Keep the file format compatible with the `mini` tool and readable by standard markdown viewers and GitHub

## Non-Goals

- Replacing the default `.md` editor (opt-in only)
- Supporting non-shell languages in this version (js, ts, python, ruby deferred)
- Building a custom webview UI (VS Code's notebook UI is used as-is)
- Full round-trip compatibility with the CLI tool's `output:` label (see Output Format below)

---

## Architecture

Three TypeScript modules inside a single VS Code extension:

```
vscode-extension/
  package.json          # extension manifest
  tsconfig.json
  src/
    extension.ts        # activate(): registers command, serializer, controller
    serializer.ts       # NotebookSerializer — .md ↔ NotebookData
    controller.ts       # NotebookController — cell execution
  out/                  # compiled JS (gitignored)
```

The extension registers a `notebookType` named `rundown`. It does **not** set itself as the default editor for `.md` files.

### Activation

Lazy activation via `onCommand:rundown.openAsNotebook`. Zero startup cost when not in use.

### `package.json` contributes

The manifest must include a `contributes.notebooks` entry for VS Code to recognize the `rundown` notebook type:

```json
"contributes": {
  "notebooks": [
    {
      "type": "rundown",
      "displayName": "rundown",
      "selector": [{ "filenamePattern": "*.md" }]
    }
  ],
  "commands": [
    {
      "command": "rundown.openAsNotebook",
      "title": "rundown: Open as Notebook"
    }
  ]
},
"activationEvents": ["onCommand:rundown.openAsNotebook"]
```

---

## Output Format

The extension uses the `mini` format: a bare ` ```output ``` ` fence immediately after the shell fence, with no `output:` label in between:

```markdown
```sh
echo hello
```

```output
hello
```
```

The CLI tool writes an `output:` label paragraph between the two fences. The extension intentionally omits this label when writing, matching `mini`. During deserialization, any `output:` paragraph appearing between a shell fence and an output fence is silently skipped so CLI-produced files parse correctly — but the label is not re-emitted on save.

---

## Serializer (`serializer.ts`)

Implements VS Code's `vscode.NotebookSerializer` interface.

### `.md` → `NotebookData` (deserialize)

Parse the file top-to-bottom, line by line:

1. **Text content** — any lines that are not inside a ` ```sh `/` ```bash ` or ` ```output ` fence, and not the bare `output:` label paragraph, accumulate into the current markup cell. When a code fence is encountered, flush the current markup cell (if non-empty) as a `NotebookCellKind.Markup` cell.
2. **` ```sh ` / ` ```bash ` fences** → `NotebookCellKind.Code` cell (language `shellscript`). The fence delimiters are stripped; only the body is stored as cell source.
3. **`output:` paragraph** — if it immediately follows a code cell (with at most one blank line between), skip it silently. Do not emit a markup cell for it.
4. **` ```output ` fence** — if it immediately follows a code cell (or an `output:` paragraph that follows a code cell), attach its content as a `NotebookCellOutput` on that code cell. Not a separate cell.

**Edge cases:**
- Empty file → zero cells (or one empty markup cell; both are acceptable)
- File with no code fences → one markup cell containing the entire file
- `output:` paragraph not adjacent to a code cell → treated as normal markup text

### `NotebookData` → `.md` (serialize)

Reconstruct the markdown file from cells:

- `Markup` cell → cell source trimmed of trailing whitespace
- `Code` cell with no output → ` ```sh\n{source}\n``` `
- `Code` cell with output → ` ```sh\n{source}\n``` ` + `\n\n` + ` ```output\n{output}\n``` `

Cells are joined with `\n\n`. Cell sources are trimmed of leading/trailing blank lines before joining to prevent whitespace inflation on repeated save. Output content is stored verbatim (trailing newline included); the serializer does not strip it.

---

## Controller (`controller.ts`)

Implements VS Code's `vscode.NotebookController`.

### Execution flow

1. Receive a `NotebookCell` execution request via the controller's `executeHandler`.
2. Write cell source to a temp file.
3. Spawn `sh <tempfile>` via Node's `child_process.spawn`.
4. Collect stdout and stderr as separate streams; concatenate as `stdout + stderr` (all stdout first, then all stderr — ordering between the two streams is not guaranteed).
5. Strip ANSI escape codes from the combined output before storing.
6. On completion:
   - If exit code is 0: set output as `NotebookCellOutputItem.text(output, 'text/plain')`, mark execution success.
   - If exit code is non-zero: set output (which may include stderr), mark execution as failed.
   - If timeout (30s): send `SIGKILL`, preserve any output collected so far, mark execution as failed with a note: `"Timed out after 30s"` appended to output.
7. Set `NotebookCellExecutionSummary` with `success` boolean and timing.
8. VS Code marks the document dirty; saving triggers the serializer, writing the output fence back to disk.

The run button and `Shift+Enter` shortcut are provided by VS Code's built-in notebook UI.

---

## Command (`extension.ts`)

| Property | Value |
|---|---|
| Command ID | `rundown.openAsNotebook` |
| Palette title | `rundown: Open as Notebook` |
| Default keybinding | none |

**Behavior:**

1. Read `vscode.window.activeTextEditor?.document.uri`.
2. If `undefined` or the file does not end in `.md`, display error: `"Open a .md file first."` and return.
3. Call `vscode.commands.executeCommand('vscode.openWith', uri, 'rundown')`.

Note: once the file is open as a notebook, `activeTextEditor` will be `undefined` (notebook editors are not text editors). The command will show the error in that case — this is accepted behavior since the file is already open as a notebook.

---

## Out of Scope (this version)

- Additional language support (js, ts, python, ruby)
- Streaming output (output shown only on completion)
- Cell-level environment variables or working directory configuration
- Extension settings/configuration panel
- Publishing to the VS Code Marketplace
- Re-emitting the CLI tool's `output:` label on save

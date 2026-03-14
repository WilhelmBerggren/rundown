# rundown VS Code Extension — Design

**Date:** 2026-03-14

A VS Code extension that brings the rundown experience (markdown with runnable shell code cells, output persisted inline) to VS Code via the native Notebook API.

---

## Goals

- Open any `.md` file as a rundown notebook via an opt-in command
- Render markdown prose as text cells and `sh`/`bash` fences as executable code cells
- Run shell cells; capture output and persist it back to the `.md` file as ` ```output ``` ` fences
- Keep the file format identical to what the existing rundown tools produce (fully interoperable with standard markdown viewers, GitHub, etc.)

## Non-Goals

- Replacing the default `.md` editor (opt-in only)
- Supporting non-shell languages in this version (js, ts, python, ruby deferred)
- Building a custom webview UI (VS Code's notebook UI is used as-is)

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

---

## Serializer (`serializer.ts`)

Implements VS Code's `NotebookSerializer` interface.

### `.md` → `NotebookData` (deserialize)

Parse the file top-to-bottom:

1. **Text blocks** (any content that is not a ` ```sh `/` ```bash ` or ` ```output ` fence) → `NotebookCellKind.Markup` cell. Consecutive non-code lines (including blank lines within a prose section) are accumulated into a single markdown cell until a code fence is encountered.
2. **` ```sh ` / ` ```bash ` fences** → `NotebookCellKind.Code` cell (language `shellscript`).
3. **` ```output ` fence** immediately following a code cell → attached as a `NotebookCellOutput` on that code cell (not a separate cell).

### `NotebookData` → `.md` (serialize)

Reconstruct the markdown file:

- `Markup` cell → raw cell source, written as-is
- `Code` cell with no output → ` ```sh\n{source}\n``` `
- `Code` cell with output → ` ```sh\n{source}\n``` ` + `\n\n` + ` ```output\n{output}\n``` `

Cells are joined with `\n\n` between them. This preserves blank-line separation visible in standard markdown renderers.

---

## Controller (`controller.ts`)

Implements VS Code's `NotebookController`.

### Execution flow

1. Receive a `NotebookCell` execution request.
2. Spawn `sh -c <cell source>` via Node's `child_process.spawn`.
3. Collect stdout and stderr (combined, in order).
4. On completion (or 30-second timeout), set cell output as `NotebookCellOutputItem.text(output, 'text/plain')`.
5. Mark execution complete. VS Code automatically marks the document dirty; saving (manual Cmd+S or workspace auto-save) triggers the serializer, writing the output fence back to disk.

The run button and `Shift+Enter` shortcut are provided by VS Code's built-in notebook UI at no cost.

---

## Command (`extension.ts`)

| Property | Value |
|---|---|
| Command ID | `rundown.openAsNotebook` |
| Palette title | `rundown: Open as Notebook` |
| Default keybinding | none |

**Behavior:** reads `vscode.window.activeTextEditor?.document.uri`, validates it is a `.md` file, then calls:

```ts
vscode.commands.executeCommand('vscode.openWith', uri, 'rundown')
```

If no `.md` file is active, displays an error notification: `"Open a .md file first."`.

---

## Data Format

Output stored inline in the `.md` file, immediately after the shell fence that produced it:

```markdown
Some prose text.

```sh
echo hello
```

```output
hello
```

More prose.
```

This format is identical to the existing rundown CLI and mini tools — files are interoperable across all three.

---

## Out of Scope (this version)

- Additional language support (js, ts, python, ruby)
- Streaming output (output shown only on completion)
- Cell-level environment variables or working directory configuration
- Extension settings/configuration panel
- Publishing to the VS Code Marketplace

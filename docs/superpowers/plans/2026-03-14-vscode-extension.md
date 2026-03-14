# rundown VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that opens `.md` files as rundown notebooks — rendering shell code fences as executable cells with output persisted inline as ` ```output ``` ` fences.

**Architecture:** TypeScript VS Code extension using the Notebook API. Pure parsing logic lives in `parse.ts` (no vscode dep, fully unit-testable). `RundownSerializer` wraps it with the `vscode.NotebookSerializer` interface. `RundownController` executes shell cells via `child_process`. A command `rundown: Open as Notebook` triggers `vscode.openWith`.

**Tech Stack:** TypeScript 5, VS Code Extension API 1.85+, Node.js `child_process` / `node:test`, `tsx` (dev test runner)

**Spec:** `docs/superpowers/specs/2026-03-14-vscode-extension-design.md`

---

## File Structure

```
vscode-extension/
  .gitignore              # ignores node_modules/, out/
  package.json            # manifest: contributes.notebooks, commands, activationEvents
  tsconfig.json           # compiles src/ → out/, excludes *.test.ts
  src/
    parse.ts              # parseMd(), serializeCells() — NO vscode import
    parse.test.ts         # unit tests for parse.ts (node:test)
    serializer.ts         # RundownSerializer — wraps parse.ts with vscode.NotebookSerializer
    controller.ts         # RundownController — executes shell cells, writes output
    extension.ts          # activate() — wires serializer, controller, command
  out/                    # compiled JS (gitignored)
```

**Why `parse.ts` is separate:** `serializer.ts` must import `vscode`, unavailable outside VS Code. Isolating parsing in `parse.ts` lets us unit-test the core logic without the VS Code runtime.

---

## Chunk 1: Scaffolding and Parse Module

### Task 1: Project Scaffolding

**Files:**
- Create: `vscode-extension/.gitignore`
- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/src/extension.ts` (stub)
- Create: `vscode-extension/src/parse.ts` (stub)
- Create: `vscode-extension/src/serializer.ts` (stub)
- Create: `vscode-extension/src/controller.ts` (stub)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p vscode-extension/src
```

- [ ] **Step 2: Write `.gitignore`**

`vscode-extension/.gitignore`:
```
node_modules/
out/
```

- [ ] **Step 3: Write `package.json`**

`vscode-extension/package.json`:
```json
{
  "name": "rundown",
  "displayName": "rundown",
  "description": "Run shell code snippets in markdown files",
  "version": "0.0.1",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Notebooks"],
  "activationEvents": ["onCommand:rundown.openAsNotebook"],
  "main": "./out/extension.js",
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
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsx --test src/parse.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

`vscode-extension/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true
  },
  "exclude": ["node_modules", ".vscode-test", "**/*.test.ts"]
}
```

Test files are excluded from the production build — `node:test` is unavailable in the VS Code extension runtime.

- [ ] **Step 5: Write source stubs**

`vscode-extension/src/parse.ts`:
```typescript
export {};
```

`vscode-extension/src/serializer.ts`:
```typescript
export {};
```

`vscode-extension/src/controller.ts`:
```typescript
export {};
```

`vscode-extension/src/extension.ts`:
```typescript
import * as vscode from 'vscode';
export function activate(_context: vscode.ExtensionContext): void {}
export function deactivate(): void {}
```

- [ ] **Step 6: Install dependencies**

```bash
cd vscode-extension && npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 7: Verify compilation**

```bash
cd vscode-extension && npm run compile
```

Expected: `out/` directory created, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add vscode-extension/
git commit -m "feat: scaffold vscode extension project"
```

---

### Task 2: Parse module — `parseMd`

**Files:**
- Modify: `vscode-extension/src/parse.ts`
- Create: `vscode-extension/src/parse.test.ts`

- [ ] **Step 1: Write types and stubs in `parse.ts`**

`vscode-extension/src/parse.ts`:
```typescript
export interface ParsedMarkupCell {
  kind: 'markup';
  source: string;
}

export interface ParsedCodeCell {
  kind: 'code';
  source: string;
  output?: string;
}

export type ParsedCell = ParsedMarkupCell | ParsedCodeCell;

export function parseMd(_content: string): ParsedCell[] {
  throw new Error('not implemented');
}

export function serializeCells(_cells: ParsedCell[]): string {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write failing tests for `parseMd`**

`vscode-extension/src/parse.test.ts`:
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMd, serializeCells, type ParsedCell } from './parse';

describe('parseMd', () => {
  it('returns [] for empty string', () => {
    assert.deepEqual(parseMd(''), []);
  });

  it('returns one markup cell for plain markdown', () => {
    assert.deepEqual(parseMd('# Hello\n\nsome text'), [
      { kind: 'markup', source: '# Hello\n\nsome text' },
    ]);
  });

  it('returns one code cell for a sh fence', () => {
    assert.deepEqual(parseMd('```sh\necho hi\n```'), [
      { kind: 'code', source: 'echo hi' },
    ]);
  });

  it('handles bash fence tag', () => {
    assert.deepEqual(parseMd('```bash\nls\n```'), [
      { kind: 'code', source: 'ls' },
    ]);
  });

  it('attaches output fence as code cell output', () => {
    assert.deepEqual(parseMd('```sh\necho hi\n```\n\n```output\nhello\n```'), [
      { kind: 'code', source: 'echo hi', output: 'hello\n' },
    ]);
  });

  it('skips output: label between code and output fence', () => {
    assert.deepEqual(
      parseMd('```sh\necho hi\n```\n\noutput:\n\n```output\nhello\n```'),
      [{ kind: 'code', source: 'echo hi', output: 'hello\n' }]
    );
  });

  it('treats standalone output: paragraph as markup text', () => {
    assert.deepEqual(parseMd('output:\n\nsome text'), [
      { kind: 'markup', source: 'output:\n\nsome text' },
    ]);
  });

  it('interleaves markup and code cells correctly', () => {
    assert.deepEqual(
      parseMd('intro\n\n```sh\necho hi\n```\n\nconclusion'),
      [
        { kind: 'markup', source: 'intro' },
        { kind: 'code', source: 'echo hi' },
        { kind: 'markup', source: 'conclusion' },
      ]
    );
  });
});

describe('serializeCells', () => {
  it('placeholder — implemented in Task 3', () => {
    // intentionally empty — tests added in Task 3
  });
});
```

- [ ] **Step 3: Run tests — expect parseMd tests to fail**

```bash
cd vscode-extension && npm test
```

Expected: 8 `parseMd` tests fail with `Error: not implemented`.

- [ ] **Step 4: Implement `parseMd`**

Replace the `parseMd` function body in `vscode-extension/src/parse.ts`:

```typescript
export function parseMd(content: string): ParsedCell[] {
  const lines = content.split('\n');
  const cells: ParsedCell[] = [];
  let markupLines: string[] = [];
  let i = 0;

  function flushMarkup() {
    const text = markupLines.join('\n').trim();
    if (text) cells.push({ kind: 'markup', source: text });
    markupLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    const codeMatch = /^```(sh|bash)\s*$/.exec(line);

    if (codeMatch) {
      flushMarkup();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i] !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      const codeCell: ParsedCodeCell = { kind: 'code', source: codeLines.join('\n') };
      cells.push(codeCell);

      // Look ahead for optional "output:" label and/or output fence
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && lines[j].trim() === 'output:') {
        j++;
        while (j < lines.length && lines[j].trim() === '') j++;
      }
      if (j < lines.length && lines[j] === '```output') {
        i = j + 1;
        const outputLines: string[] = [];
        while (i < lines.length && lines[i] !== '```') {
          outputLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        codeCell.output = outputLines.join('\n') + '\n';
      }
    } else {
      markupLines.push(line);
      i++;
    }
  }

  flushMarkup();
  return cells;
}
```

- [ ] **Step 5: Run tests — expect all parseMd tests to pass**

```bash
cd vscode-extension && npm test
```

Expected: 8 `parseMd` tests pass. The placeholder `serializeCells` test passes trivially.

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/src/parse.ts vscode-extension/src/parse.test.ts
git commit -m "feat: implement parseMd with unit tests"
```

---

### Task 3: Parse module — `serializeCells`

**Files:**
- Modify: `vscode-extension/src/parse.ts` (replace stub)
- Modify: `vscode-extension/src/parse.test.ts` (replace placeholder describe block)

- [ ] **Step 1: Replace the placeholder serializeCells describe block in `parse.test.ts`**

Replace the entire `describe('serializeCells', ...)` block (the placeholder at the bottom of the file) with:

```typescript
describe('serializeCells', () => {
  it('returns empty string for no cells', () => {
    assert.equal(serializeCells([]), '');
  });

  it('serializes a markup cell', () => {
    assert.equal(
      serializeCells([{ kind: 'markup', source: '# Hello' }]),
      '# Hello\n'
    );
  });

  it('trims leading/trailing blank lines from markup source', () => {
    assert.equal(
      serializeCells([{ kind: 'markup', source: '\n\n# Hello\n\n' }]),
      '# Hello\n'
    );
  });

  it('serializes a code cell without output', () => {
    assert.equal(
      serializeCells([{ kind: 'code', source: 'echo hi' }]),
      '```sh\necho hi\n```\n'
    );
  });

  it('serializes a code cell with output', () => {
    assert.equal(
      serializeCells([{ kind: 'code', source: 'echo hi', output: 'hello\n' }]),
      '```sh\necho hi\n```\n\n```output\nhello\n```\n'
    );
  });

  it('serializes mixed cells with correct separators', () => {
    assert.equal(
      serializeCells([
        { kind: 'markup', source: 'intro' },
        { kind: 'code', source: 'echo hi' },
        { kind: 'markup', source: 'end' },
      ]),
      'intro\n\n```sh\necho hi\n```\n\nend\n'
    );
  });
});
```

- [ ] **Step 2: Run tests — expect serializeCells tests to fail**

```bash
cd vscode-extension && npm test
```

Expected: 8 `parseMd` tests pass, 6 `serializeCells` tests fail with `Error: not implemented`.

- [ ] **Step 3: Implement `serializeCells`**

Replace the `serializeCells` function body in `vscode-extension/src/parse.ts`:

```typescript
export function serializeCells(cells: ParsedCell[]): string {
  const parts: string[] = [];

  for (const cell of cells) {
    if (cell.kind === 'markup') {
      const source = cell.source.replace(/^\n+|\n+$/g, '');
      if (source) parts.push(source);
    } else {
      const source = cell.source.replace(/^\n+|\n+$/g, '');
      let block = '```sh\n' + source + '\n```';
      if (cell.output !== undefined) {
        block += '\n\n```output\n' + cell.output + '```';
      }
      parts.push(block);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') + '\n' : '';
}
```

- [ ] **Step 4: Run tests — expect all 14 to pass**

```bash
cd vscode-extension && npm test
```

Expected: 14 tests pass (8 parseMd + 6 serializeCells), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/parse.ts vscode-extension/src/parse.test.ts
git commit -m "feat: implement serializeCells with unit tests"
```

---

## Chunk 2: VS Code Integration

### Task 4: Serializer class

**Files:**
- Modify: `vscode-extension/src/serializer.ts`

No automated tests — compilation is the verification.

- [ ] **Step 1: Write `serializer.ts`**

`vscode-extension/src/serializer.ts`:
```typescript
import * as vscode from 'vscode';
import { parseMd, serializeCells, type ParsedCell } from './parse';

export class RundownSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(content: Uint8Array): vscode.NotebookData {
    const text = new TextDecoder().decode(content);
    const parsed = parseMd(text);

    const cells = parsed.map((cell): vscode.NotebookCellData => {
      if (cell.kind === 'markup') {
        return new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          cell.source,
          'markdown'
        );
      } else {
        const cellData = new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          cell.source,
          'shellscript'
        );
        if (cell.output !== undefined) {
          cellData.outputs = [
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.text(cell.output),
            ]),
          ];
        }
        return cellData;
      }
    });

    return new vscode.NotebookData(cells);
  }

  serializeNotebook(data: vscode.NotebookData): Uint8Array {
    const cells: ParsedCell[] = data.cells.map((cell) => {
      if (cell.kind === vscode.NotebookCellKind.Markup) {
        return { kind: 'markup', source: cell.value };
      } else {
        const item = cell.outputs?.[0]?.items?.[0];
        const outputText = item ? new TextDecoder().decode(item.data) : undefined;
        return { kind: 'code', source: cell.value, output: outputText };
      }
    });

    return new TextEncoder().encode(serializeCells(cells));
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd vscode-extension && npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/serializer.ts
git commit -m "feat: implement RundownSerializer"
```

---

### Task 5: Controller class

**Files:**
- Modify: `vscode-extension/src/controller.ts`

- [ ] **Step 1: Write `controller.ts`**

`vscode-extension/src/controller.ts`:
```typescript
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const TIMEOUT_MS = 30_000;
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export class RundownController {
  private readonly controller: vscode.NotebookController;

  constructor() {
    this.controller = vscode.notebooks.createNotebookController(
      'rundown-controller',
      'rundown',
      'rundown'
    );
    this.controller.supportedLanguages = ['shellscript'];
    this.controller.executeHandler = this.execute.bind(this);
  }

  private async execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    for (const cell of cells) {
      await this.executeCell(cell);
    }
  }

  private async executeCell(cell: vscode.NotebookCell): Promise<void> {
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.start(Date.now());

    const tmpFile = path.join(os.tmpdir(), `rundown-${Date.now()}.sh`);
    fs.writeFileSync(tmpFile, cell.document.getText());

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    await new Promise<void>((resolve) => {
      const proc = cp.spawn('sh', [tmpFile]);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);

        let combined = (stdout + stderr).replace(ANSI_RE, '');
        if (timedOut) combined += '\nTimed out after 30s';

        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(combined),
          ]),
        ]);

        execution.end(!timedOut && code === 0, Date.now());
        resolve();
      });
    });

    try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
  }

  dispose(): void {
    this.controller.dispose();
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd vscode-extension && npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/controller.ts
git commit -m "feat: implement RundownController"
```

---

### Task 6: Extension entry point

**Files:**
- Modify: `vscode-extension/src/extension.ts`

- [ ] **Step 1: Write `extension.ts`**

`vscode-extension/src/extension.ts`:
```typescript
import * as vscode from 'vscode';
import { RundownSerializer } from './serializer';
import { RundownController } from './controller';

export function activate(context: vscode.ExtensionContext): void {
  const serializer = new RundownSerializer();
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer('rundown', serializer)
  );

  const controller = new RundownController();
  context.subscriptions.push({ dispose: () => controller.dispose() });

  const command = vscode.commands.registerCommand(
    'rundown.openAsNotebook',
    () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !uri.fsPath.endsWith('.md')) {
        vscode.window.showErrorMessage('Open a .md file first.');
        return;
      }
      vscode.commands.executeCommand('vscode.openWith', uri, 'rundown');
    }
  );
  context.subscriptions.push(command);
}

export function deactivate(): void {}
```

- [ ] **Step 2: Compile the full extension**

```bash
cd vscode-extension && npm run compile
```

Expected: `out/extension.js`, `out/serializer.js`, `out/controller.js`, `out/parse.js` all generated, no errors.

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/extension.ts
git commit -m "feat: wire extension entry point and command"
```

---

### Task 7: Manual Verification

The VS Code extension runtime cannot be automated — these steps require human interaction.

- [ ] **Step 1: Add a launch configuration**

`vscode-extension/.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
    }
  ]
}
```

```bash
mkdir -p vscode-extension/.vscode
```

Then create the file above.

- [ ] **Step 2: Open the extension folder in VS Code**

```bash
code vscode-extension/
```

- [ ] **Step 3: Launch Extension Development Host**

Press `F5` (or `Run → Start Debugging`). A second VS Code window opens with the extension loaded.

- [ ] **Step 4: Open a test markdown file with shell fences**

In the Extension Development Host window, open any `.md` file that contains a ` ```sh ``` ` block (e.g. the repo root `README.md`).

- [ ] **Step 5: Run the command**

Open Command Palette (`Cmd+Shift+P`) → `rundown: Open as Notebook`.

Expected: file re-opens as a notebook. Markdown cells render as formatted text. Shell code blocks appear as executable cells.

- [ ] **Step 6: Execute a cell and verify output**

Click the Run button (or `Shift+Enter`) on a shell cell.

Expected:
- Cell output appears below the cell.
- Pressing `Cmd+S` saves the file.
- The saved `.md` file now contains a ` ```output ``` ` fence immediately after the shell block.

- [ ] **Step 7: Verify error case**

Open a non-markdown file (or no file), run `rundown: Open as Notebook`.

Expected: VS Code shows error notification: `"Open a .md file first."`

- [ ] **Step 8: Commit launch config**

```bash
git add vscode-extension/.vscode/launch.json
git commit -m "chore: add vscode extension launch config"
```

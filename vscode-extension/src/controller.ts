import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as crypto from 'crypto';
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

    const tmpFile = path.join(os.tmpdir(), `rundown-${crypto.randomUUID()}.sh`);
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

      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(`Failed to start shell: ${err.message}`, 'text/plain'),
          ]),
        ]);
        execution.end(false, Date.now());
        resolve();
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);

        // stdout collected first, then stderr — stream ordering not guaranteed
        let combined = (stdout + stderr).replace(ANSI_RE, '');
        if (timedOut) combined += '\nTimed out after 30s';

        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(combined, 'text/plain'),
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

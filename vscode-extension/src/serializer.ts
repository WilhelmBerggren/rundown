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
              vscode.NotebookCellOutputItem.text(cell.output, 'text/plain'),
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
        // Reads first item of first output only — controller always calls replaceOutput (not append)
        const item = cell.outputs?.[0]?.items?.[0];
        const outputText = item ? new TextDecoder().decode(item.data) : undefined;
        return { kind: 'code', source: cell.value, output: outputText };
      }
    });

    return new TextEncoder().encode(serializeCells(cells));
  }
}

import * as vscode from 'vscode';
import { RundownSerializer } from './serializer';
import { RundownController } from './controller';

export function activate(context: vscode.ExtensionContext): void {
  const serializer = new RundownSerializer();
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer('rundown', serializer)
  );

  const controller = new RundownController();
  context.subscriptions.push(controller);

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

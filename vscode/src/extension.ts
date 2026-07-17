import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("csslit.helloWorld", () => {
      void vscode.window.showInformationMessage("Hello World from csslit!");
    }),
  );
}

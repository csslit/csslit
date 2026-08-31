import { connect } from "node:net";
import { createInterface } from "node:readline";
import * as vscode from "vscode";
import type { VirtualCss } from "../virtual-css.ts";

const harnessPort = Number(process.env["CSSLIT_HARNESS_PORT"]);

export interface HarnessInit {
  activateExtension?: string | undefined;
  expectedFrameworkPlugin?:
    | {
        name: string;
        position: "before" | "after";
      }
    | undefined;
  file: string;
}

export interface HarnessRequest {
  source: string;
  offset: number;
}

export interface HarnessResult {
  virtualCss: VirtualCss | null;
  parsed: boolean;
}

export type HarnessResponse = HarnessResult | string;

export async function activate(): Promise<void> {
  const socket = connect(harnessPort, "127.0.0.1");
  const requests = createInterface({
    input: socket,
    crlfDelay: Infinity,
  })[Symbol.asyncIterator]();

  const first = await requests.next();
  const init = JSON.parse(first.value!) as HarnessInit;

  if (init.activateExtension) {
    await vscode.extensions.getExtension(init.activateExtension)!.activate();
  }
  await vscode.extensions.getExtension("csslit.csslit-vscode")!.activate();

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(init.file));
  await vscode.commands.executeCommand("_typescript.configurePlugin", "@csslit/typescript-plugin", {
    testReadiness: {
      port: harnessPort,
      file: init.file,
      expectedFrameworkPlugin: init.expectedFrameworkPlugin,
    },
  });
  await vscode.commands.executeCommand(
    "_csslit.getVirtualCss",
    document.uri,
    document.positionAt(0),
  );

  for await (const line of requests) {
    const request = JSON.parse(line) as HarnessRequest;
    const current = document.getText();
    if (current !== request.source) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(current.length)),
        request.source,
      );
      await vscode.workspace.applyEdit(edit);
    }

    let result: HarnessResponse;
    try {
      result = await vscode.commands.executeCommand<HarnessResult>(
        "_csslit.getVirtualCss",
        document.uri,
        document.positionAt(request.offset),
      );
    } catch (error) {
      result = String(error instanceof Error ? error.stack : error);
    }
    socket.write(`${JSON.stringify(result)}\n`);
  }
}

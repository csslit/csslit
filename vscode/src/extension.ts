import type { API } from "typescript/unstable/async";
import * as vscode from "vscode";
import {
  getVirtualCss,
  loadTypeScript,
  StaleSourceFileError,
  toSourceRange,
} from "./virtual-css.ts";
import type { TypeScriptModules, VirtualCss } from "./virtual-css.ts";

const CSS_DOCUMENT_SCHEME = "csslit-css";
const TS_EXTENSION_ID = "TypeScriptTeam.native-preview";
const languageSelector: vscode.DocumentSelector = [
  { language: "javascript" },
  { language: "javascriptreact" },
  { language: "typescript" },
  { language: "typescriptreact" },
];

type Connection = { ts: TypeScriptModules; api: API<boolean> };

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("csslit", { log: true });
  const virtualDocuments = new Map<string, { content: string; references: number }>();
  const sourceDocumentIds = new WeakMap<vscode.TextDocument, number>();
  let nextSourceDocumentId = 0;
  let nextCompletionRequestId = 0;

  let connection: Connection | undefined;
  let connectionPromise: Promise<Connection | undefined> | undefined;
  let connectionFailed = false;
  let connectionIssue: string | undefined;
  const noConnection = Promise.resolve<Connection | undefined>(undefined);
  output.info("Activated");

  function getConnection(): Promise<Connection | undefined> {
    if (connection) return Promise.resolve(connection);
    if (connectionPromise) return connectionPromise;
    if (connectionFailed) return noConnection;
    let latchFailure = false;
    const attempt = (async () => {
      const tsExtension = vscode.extensions.getExtension(TS_EXTENSION_ID);
      if (!tsExtension) {
        latchFailure = true;
        const issue = `${TS_EXTENSION_ID} is required for css language features`;
        if (connectionIssue !== issue) output.warn(issue);
        connectionIssue = issue;
        return undefined;
      }
      const configuration = vscode.workspace.getConfiguration();
      if (
        !configuration.get<boolean>("js/ts.experimental.useTsgo") &&
        !configuration.get<boolean>("typescript.experimental.useTsgo")
      ) {
        latchFailure = true;
        const issue =
          "TypeScript 7 is not enabled; run TypeScript: Enable TypeScript 7 from the Command Palette";
        if (connectionIssue !== issue) output.warn(issue);
        connectionIssue = issue;
        return undefined;
      }
      try {
        const tsApi = (await tsExtension.activate()) as
          | {
              initializeAPIConnection?: () => Promise<string>;
            }
          | undefined;
        const pipe = await tsApi?.initializeAPIConnection?.();
        if (typeof pipe !== "string") {
          const issue =
            "TypeScript 7 is not enabled; run TypeScript: Enable TypeScript 7 from the Command Palette";
          if (connectionIssue !== issue) output.warn(issue);
          connectionIssue = issue;
          return undefined;
        }
        const ts = await loadTypeScript();
        const api = await ts.async.API.fromLSPConnection({ pipe });
        connectionIssue = undefined;
        output.info("Connected to the TypeScript API session");
        return { ts, api };
      } catch (error) {
        const issue = "Connecting to the TypeScript API session failed";
        if (connectionIssue !== issue) output.error(issue, error);
        connectionIssue = issue;
        return undefined;
      }
    })();
    connectionPromise = attempt;
    void attempt.then((result) => {
      if (connectionPromise !== attempt) {
        if (result)
          void result.api
            .close()
            .catch((error) => output.trace("Closing obsolete connection", error));
        return;
      }
      connectionPromise = undefined;
      connection = result;
      connectionFailed = !result && latchFailure;
    });
    return attempt;
  }

  function invalidateConnection(failed: Connection): void {
    if (connection !== failed) return;
    connection = undefined;
    void failed.api.close().catch((error) => output.trace("Closing failed connection", error));
  }

  function resetConnection(): void {
    connectionFailed = false;
    connectionIssue = undefined;
    connectionPromise = undefined;
    if (!connection) return;
    const previous = connection;
    connection = undefined;
    void previous.api.close().catch((error) => output.trace("Closing connection", error));
  }

  function virtualUri(
    documentId: number,
    documentVersion: number,
    templateStart: number,
  ): vscode.Uri {
    return vscode.Uri.from({
      scheme: CSS_DOCUMENT_SCHEME,
      authority: "embedded",
      path: `/${documentId}/${documentVersion}/${templateStart}.css`,
    });
  }

  async function getVirtualCssDocument(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ) {
    let documentId = sourceDocumentIds.get(document);
    if (documentId === undefined) {
      documentId = nextSourceDocumentId++;
      sourceDocumentIds.set(document, documentId);
    }
    const documentVersion = document.version;
    const connection = await getConnection();
    if (!connection) return;
    const sourceOffset = document.offsetAt(position);
    const source = document.getText();
    let refresh = false;
    for (;;) {
      try {
        const virtualCss = await getVirtualCss(
          connection.ts,
          connection.api,
          document.uri.toString(),
          sourceOffset,
          source,
          refresh,
        );
        if (!virtualCss || document.version !== documentVersion) return;
        return {
          ...virtualCss,
          uri: virtualUri(documentId, documentVersion, virtualCss.templateStart),
          sourceOffset,
        };
      } catch (error) {
        if (error instanceof StaleSourceFileError && !refresh) {
          output.debug(`Waiting for tsgo to reach document version ${documentVersion}`);
          try {
            await vscode.commands.executeCommand(
              "vscode.executeSelectionRangeProvider",
              document.uri,
              [position],
            );
          } catch (syncError) {
            output.error("Synchronizing with tsgo failed", syncError);
            return;
          }
          if (token.isCancellationRequested || document.version !== documentVersion) return;
          refresh = true;
          continue;
        }
        invalidateConnection(connection);
        output.error("Locating templates failed", error);
        return;
      }
    }
  }

  async function withVirtualDocument<T>(
    virtualDocument: { content: string; uri: vscode.Uri },
    use: (document: vscode.TextDocument) => Promise<T>,
  ): Promise<T> {
    const key = virtualDocument.uri.toString();
    let entry = virtualDocuments.get(key);
    if (entry) {
      entry.references++;
    } else {
      entry = { content: virtualDocument.content, references: 1 };
      virtualDocuments.set(key, entry);
    }

    try {
      return await use(await vscode.workspace.openTextDocument(virtualDocument.uri));
    } finally {
      if (--entry.references === 0) virtualDocuments.delete(key);
    }
  }

  context.subscriptions.push(
    output,
    vscode.workspace.registerTextDocumentContentProvider(CSS_DOCUMENT_SCHEME, {
      provideTextDocumentContent(uri) {
        return virtualDocuments.get(uri.toString())?.content;
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      languageSelector,
      {
        async provideCompletionItems(document, position, token, completionContext) {
          const requestId = ++nextCompletionRequestId;
          const started = performance.now();
          output.trace(
            `[completion ${requestId}] ${document.uri.toString()}:${position.line + 1}:${position.character + 1} version ${document.version}`,
          );
          const virtualCss = await getVirtualCssDocument(document, position, token);
          if (!virtualCss) {
            output.trace(`[completion ${requestId}] no csslit template`);
            return;
          }
          if (token.isCancellationRequested) {
            output.trace(`[completion ${requestId}] cancelled after locating template`);
            return;
          }
          const trace = output.logLevel === vscode.LogLevel.Trace;
          if (trace) {
            output.trace(
              `[completion ${requestId}] ${virtualCss.uri.toString()} offset ${virtualCss.offset}, exact ${virtualCss.offsetExact}, attached hole ${Boolean(virtualCss.attachedHole)}\n${JSON.stringify(virtualCss.content)}`,
            );
          }

          try {
            return await withVirtualDocument(virtualCss, async (virtualDocument) => {
              if (token.isCancellationRequested) return;
              const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                virtualCss.uri,
                virtualDocument.positionAt(virtualCss.offset),
                completionContext.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter &&
                  (completionContext.triggerCharacter === "/" ||
                    completionContext.triggerCharacter === "-" ||
                    completionContext.triggerCharacter === ":")
                  ? completionContext.triggerCharacter
                  : undefined,
              );
              if (token.isCancellationRequested) {
                output.trace(`[completion ${requestId}] cancelled after css service request`);
                return;
              }
              if (!list) {
                output.warn(`[completion ${requestId}] css service returned no completion list`);
                return;
              }
              const offered = list.items.length;
              const sample = trace
                ? list.items.slice(0, 8).map((item) => ({
                    label: typeof item.label === "string" ? item.label : item.label.label,
                    kind: item.kind,
                    insertText:
                      typeof item.insertText === "string"
                        ? item.insertText
                        : item.insertText instanceof vscode.SnippetString
                          ? item.insertText.value
                          : undefined,
                    range: item.range,
                    textEdit: item.textEdit,
                  }))
                : undefined;
              let kept = 0;
              for (const item of list.items) {
                if (mapCompletionItem(item, virtualCss, virtualDocument, document)) {
                  list.items[kept++] = item;
                }
              }
              list.items.length = kept;
              output.debug(
                `[completion ${requestId}] kept ${kept}/${offered} items in ${Math.round(performance.now() - started)} ms`,
              );
              if (sample) output.trace(`[completion ${requestId}] raw sample`, sample);
              return list;
            });
          } catch (error) {
            output.error(`[completion ${requestId}] failed`, error);
            return;
          }
        },
      },
      ".",
      "/",
      ":",
      "-",
      "@",
    ),
    vscode.languages.registerHoverProvider(languageSelector, {
      async provideHover(document, position, token) {
        try {
          const virtualCss = await getVirtualCssDocument(document, position, token);
          if (!virtualCss || token.isCancellationRequested) return;

          return await withVirtualDocument(virtualCss, async (virtualDocument) => {
            if (token.isCancellationRequested) return;
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
              "vscode.executeHoverProvider",
              virtualCss.uri,
              virtualDocument.positionAt(virtualCss.offset),
            );
            if (token.isCancellationRequested) return;
            const hover = hovers?.[0];
            if (!hover) return;
            return new vscode.Hover(
              hover.contents,
              hover.range &&
                sourceRange(virtualCss.mappings, virtualDocument, document, hover.range),
            );
          });
        } catch (error) {
          output.error("Hover failed", error);
          return;
        }
      },
    }),
    vscode.extensions.onDidChange(resetConnection),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("js/ts.experimental.useTsgo") ||
        event.affectsConfiguration("typescript.experimental.useTsgo")
      ) {
        resetConnection();
      }
    }),
    new vscode.Disposable(() => {
      if (connection) void connection.api.close();
      else void connectionPromise?.then((result) => result?.api.close());
    }),
  );
}

type RequestMapping = Pick<VirtualCss, "mappings" | "offset" | "offsetExact" | "attachedHole"> & {
  sourceOffset: number;
};

function mapCompletionItem(
  item: vscode.CompletionItem,
  mapping: RequestMapping,
  virtualDocument: vscode.TextDocument,
  document: vscode.TextDocument,
): boolean {
  let hasPrimaryEdit = false;

  if (mapping.attachedHole) {
    if (
      item.kind !== vscode.CompletionItemKind.Unit ||
      typeof item.label !== "string" ||
      typeof item.insertText !== "string" ||
      !item.range ||
      item.label.charCodeAt(0) !== 48 ||
      item.insertText.charCodeAt(0) !== 48
    ) {
      return false;
    }

    const virtualRange = item.range instanceof vscode.Range ? item.range : item.range.replacing;
    const virtualStart = virtualDocument.offsetAt(virtualRange.start);
    const virtualEnd = virtualDocument.offsetAt(virtualRange.end);
    const hole = mapping.attachedHole;
    if (
      virtualStart < hole.virtualStart ||
      virtualStart > hole.virtualEnd ||
      virtualEnd < hole.virtualEnd ||
      virtualStart > mapping.offset ||
      virtualEnd < mapping.offset
    ) {
      return false;
    }

    let sourceEnd = hole.sourceEnd;
    if (virtualEnd > hole.virtualEnd) {
      const suffix = toSourceRange(mapping.mappings, hole.virtualEnd, virtualEnd);
      if (!suffix || suffix[0] !== hole.sourceEnd) return false;
      sourceEnd = suffix[1];
    }

    const range = new vscode.Range(
      document.positionAt(hole.sourceEnd),
      document.positionAt(sourceEnd),
    );
    item.label = item.label.slice(1);
    item.filterText = item.label;
    item.insertText = item.insertText.slice(1);
    item.range = range;
    if (item.textEdit) {
      if (item.textEdit.newText.charCodeAt(0) !== 48) return false;
      item.textEdit.range = range;
      item.textEdit.newText = item.textEdit.newText.slice(1);
    }
    hasPrimaryEdit = true;
  } else if (item.range instanceof vscode.Range) {
    const range = completionRange(mapping, virtualDocument, document, item.range);
    if (!range) return false;
    item.range = range;
    hasPrimaryEdit = true;
  } else if (item.range) {
    const inserting = completionRange(mapping, virtualDocument, document, item.range.inserting);
    const replacing = completionRange(mapping, virtualDocument, document, item.range.replacing);
    if (!inserting || !replacing) return false;
    item.range = { inserting, replacing };
    hasPrimaryEdit = true;
  }

  if (!mapping.attachedHole && item.textEdit) {
    const range = completionRange(mapping, virtualDocument, document, item.textEdit.range);
    if (!range) return false;
    item.textEdit.range = range;
    hasPrimaryEdit = true;
  }

  if (!hasPrimaryEdit) {
    const position = virtualDocument.positionAt(mapping.offset);
    const replacing =
      virtualDocument.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
    const inserting = new vscode.Range(replacing.start, position);
    const sourceInserting = completionRange(mapping, virtualDocument, document, inserting);
    const sourceReplacing = completionRange(mapping, virtualDocument, document, replacing);
    if (!sourceInserting || !sourceReplacing) return false;
    item.range = { inserting: sourceInserting, replacing: sourceReplacing };
  }

  if (item.additionalTextEdits) {
    let kept = 0;
    for (const edit of item.additionalTextEdits) {
      const range = sourceRange(mapping.mappings, virtualDocument, document, edit.range);
      if (!range) continue;
      edit.range = range;
      item.additionalTextEdits[kept++] = edit;
    }
    item.additionalTextEdits.length = kept;
  }

  return true;
}

function completionRange(
  mapping: RequestMapping,
  virtualDocument: vscode.TextDocument,
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range | undefined {
  const start = virtualDocument.offsetAt(range.start);
  const end = virtualDocument.offsetAt(range.end);
  if (start === end && start === mapping.offset && mapping.offsetExact) {
    const position = document.positionAt(mapping.sourceOffset);
    return new vscode.Range(position, position);
  }
  return sourceRange(mapping.mappings, virtualDocument, document, range);
}

function sourceRange(
  mappings: readonly number[],
  virtualDocument: vscode.TextDocument,
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range | undefined {
  const offsets = toSourceRange(
    mappings,
    virtualDocument.offsetAt(range.start),
    virtualDocument.offsetAt(range.end),
  );
  if (!offsets) return undefined;
  return new vscode.Range(document.positionAt(offsets[0]), document.positionAt(offsets[1]));
}

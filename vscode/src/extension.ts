import * as vscode from "vscode";
import { mapCompletionItem, sourceRange } from "./completions.ts";
import { parseModule as parseTsrxModule } from "./parsers/tsrx.ts";
import { TypeScriptParser } from "./parsers/typescript.ts";
import { parseModule as parseTypeScript6Module } from "./parsers/typescript6.ts";
import { buildVirtualCss } from "./virtual-css.ts";

const CSS_DOCUMENT_SCHEME = "csslit-css";
const languageSelector: vscode.DocumentSelector = [
  { language: "javascript" },
  { language: "javascriptreact" },
  { language: "typescript" },
  { language: "typescriptreact" },
  { language: "ripple" },
];

function useTypeScript7(): boolean {
  const configuration = vscode.workspace.getConfiguration();
  return (
    configuration.get<boolean>("js/ts.experimental.useTsgo") ??
    configuration.get<boolean>("typescript.experimental.useTsgo") ??
    false
  );
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

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("csslit", { log: true });
  context.subscriptions.push(output);
  const virtualDocuments = new Map<string, { content: string; references: number }>();
  const sourceDocumentIds = new WeakMap<vscode.TextDocument, number>();
  let nextSourceDocumentId = 0;
  let nextCompletionRequestId = 0;

  const typeScriptParser = new TypeScriptParser(output, vscode);
  context.subscriptions.push(typeScriptParser);
  output.info("Activated");

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
    const sourceOffset = document.offsetAt(position);
    const source = document.getText();
    if (document.languageId === "ripple") {
      const module = parseTsrxModule(source, document.fileName);
      const virtualCss = module && buildVirtualCss(module, sourceOffset);
      if (!virtualCss || document.version !== documentVersion) return;
      return {
        ...virtualCss,
        uri: virtualUri(documentId, documentVersion, virtualCss.templateStart),
      };
    }

    if (!useTypeScript7()) {
      let virtualCss;
      try {
        virtualCss = buildVirtualCss(
          parseTypeScript6Module(source, document.fileName, document.languageId),
          sourceOffset,
        );
      } catch (error) {
        output.error("TypeScript 6 parser failed", error);
        return;
      }
      if (!virtualCss || document.version !== documentVersion) return;
      return {
        ...virtualCss,
        uri: virtualUri(documentId, documentVersion, virtualCss.templateStart),
      };
    }

    const module = await typeScriptParser.parse(document, position, token);
    const virtualCss = module && buildVirtualCss(module, sourceOffset);
    if (!virtualCss || document.version !== documentVersion) return;
    return {
      ...virtualCss,
      uri: virtualUri(documentId, documentVersion, virtualCss.templateStart),
    };
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
    vscode.workspace.registerTextDocumentContentProvider(CSS_DOCUMENT_SCHEME, {
      provideTextDocumentContent(uri) {
        return virtualDocuments.get(uri.toString())?.content;
      },
    }),
  );

  context.subscriptions.push(
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
              `[completion ${requestId}] ${virtualCss.uri.toString()} offset ${virtualCss.cursor.virtual}, exact ${virtualCss.cursor.exact}, unit suffix ${Boolean(virtualCss.unitSuffix)}\n${JSON.stringify(virtualCss.content)}`,
            );
          }

          try {
            return await withVirtualDocument(virtualCss, async (virtualDocument) => {
              if (token.isCancellationRequested) return;
              const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                virtualCss.uri,
                virtualDocument.positionAt(virtualCss.cursor.virtual),
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
  );

  context.subscriptions.push(
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
              virtualDocument.positionAt(virtualCss.cursor.virtual),
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
  );

  context.subscriptions.push(vscode.extensions.onDidChange(() => typeScriptParser.reset()));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("js/ts.experimental.useTsgo") ||
        event.affectsConfiguration("typescript.experimental.useTsgo")
      ) {
        typeScriptParser.reset();
      }
    }),
  );
}

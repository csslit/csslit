import {
  window,
  workspace,
  languages,
  extensions,
  CompletionItem,
  SnippetString,
  CompletionItemKind,
  Range,
  Disposable,
  Position,
  Uri,
  CompletionList,
  LogLevel,
  commands,
  CompletionTriggerKind,
  Hover,
} from "vscode";
import type {
  DocumentSelector,
  ExtensionContext,
  TextDocument,
  CompletionItemProvider,
  HoverProvider,
  TextDocumentContentProvider,
  LogOutputChannel,
  CancellationToken,
  CompletionContext,
} from "vscode";
import { TypescriptParser } from "./typescript-parser.ts";
import { TypescriptLegacyParser } from "./typescript-legacy-parser.ts";
import { buildVirtualCss, toSourceRange } from "./virtual-css.ts";
import type { VirtualCss } from "./virtual-css.ts";

const CSS_DOCUMENT_SCHEME = "csslit-css";
const languageSelector: DocumentSelector = [
  { language: "javascript" },
  { language: "javascriptreact" },
  { language: "typescript" },
  { language: "typescriptreact" },
  { language: "ripple" },
  { language: "vue" },
  { language: "svelte" },
  { language: "astro" },
  { language: "mdx" },
];
const typeScriptLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("csslit", { log: true });
  context.subscriptions.push(output);
  output.info("Activated");

  const extension = new Extension(output);
  context.subscriptions.push(
    extension,
    workspace.registerTextDocumentContentProvider(CSS_DOCUMENT_SCHEME, extension),
    languages.registerCompletionItemProvider(languageSelector, extension, ".", "/", ":", "-", "@"),
    languages.registerHoverProvider(languageSelector, extension),
    extensions.onDidChange(() => extension.resetParsers()),
    workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("js/ts.experimental.useTsgo") ||
        event.affectsConfiguration("typescript.experimental.useTsgo") ||
        event.affectsConfiguration("svelte.enable-ts-plugin")
      ) {
        extension.resetParsers();
      }
    }),
  );
}

function sampleCompletionItems(items: readonly CompletionItem[]) {
  return items.slice(0, 8).map((item) => ({
    label: typeof item.label === "string" ? item.label : item.label.label,
    kind: item.kind,
    insertText:
      typeof item.insertText === "string"
        ? item.insertText
        : item.insertText instanceof SnippetString
          ? item.insertText.value
          : undefined,
    range: item.range,
    textEdit: item.textEdit,
  }));
}

/**
 * Rewrites a css service completion item in place so its edits target the source document.
 * Returns false when an edit cannot be mapped and the item must be dropped.
 */
function mapCompletionItem(
  item: CompletionItem,
  virtualCss: VirtualCss,
  virtualDocument: TextDocument,
  document: TextDocument,
): boolean {
  let hasPrimaryEdit = false;

  if (virtualCss.unitSuffix) {
    if (
      item.kind !== CompletionItemKind.Unit ||
      typeof item.label !== "string" ||
      typeof item.insertText !== "string" ||
      !item.range ||
      item.label.charCodeAt(0) !== 48 ||
      item.insertText.charCodeAt(0) !== 48
    ) {
      return false;
    }

    const virtualRange = item.range instanceof Range ? item.range : item.range.replacing;
    const virtualStart = virtualDocument.offsetAt(virtualRange.start);
    const virtualEnd = virtualDocument.offsetAt(virtualRange.end);
    const suffix = virtualCss.unitSuffix;
    if (
      virtualStart < suffix.virtualStart ||
      virtualStart > suffix.virtualEnd ||
      virtualEnd < suffix.virtualEnd ||
      virtualStart > virtualCss.cursor.virtual ||
      virtualEnd < virtualCss.cursor.virtual
    ) {
      return false;
    }

    let sourceEnd = suffix.sourceStart;
    if (virtualEnd > suffix.virtualEnd) {
      const mapped = toSourceRange(virtualCss.mappings, suffix.virtualEnd, virtualEnd);
      if (!mapped || mapped[0] !== suffix.sourceStart) return false;
      sourceEnd = mapped[1];
    }

    const range = new Range(
      document.positionAt(suffix.sourceStart),
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
  } else if (item.range instanceof Range) {
    const range = completionRange(virtualCss, virtualDocument, document, item.range);
    if (!range) return false;
    item.range = range;
    hasPrimaryEdit = true;
  } else if (item.range) {
    const inserting = completionRange(virtualCss, virtualDocument, document, item.range.inserting);
    const replacing = completionRange(virtualCss, virtualDocument, document, item.range.replacing);
    if (!inserting || !replacing) return false;
    item.range = { inserting, replacing };
    hasPrimaryEdit = true;
  }

  if (!virtualCss.unitSuffix && item.textEdit) {
    const range = completionRange(virtualCss, virtualDocument, document, item.textEdit.range);
    if (!range) return false;
    item.textEdit.range = range;
    hasPrimaryEdit = true;
  }

  if (!hasPrimaryEdit) {
    const position = virtualDocument.positionAt(virtualCss.cursor.virtual);
    const replacing =
      virtualDocument.getWordRangeAtPosition(position) ?? new Range(position, position);
    const inserting = new Range(replacing.start, position);
    const sourceInserting = completionRange(virtualCss, virtualDocument, document, inserting);
    const sourceReplacing = completionRange(virtualCss, virtualDocument, document, replacing);
    if (!sourceInserting || !sourceReplacing) return false;
    item.range = { inserting: sourceInserting, replacing: sourceReplacing };
  }

  if (item.additionalTextEdits) {
    let kept = 0;
    for (const edit of item.additionalTextEdits) {
      const range = sourceRange(virtualCss.mappings, virtualDocument, document, edit.range);
      if (!range) continue;
      edit.range = range;
      item.additionalTextEdits[kept++] = edit;
    }
    item.additionalTextEdits.length = kept;
  }

  return true;
}

function completionRange(
  virtualCss: VirtualCss,
  virtualDocument: TextDocument,
  document: TextDocument,
  range: Range,
): Range | undefined {
  const start = virtualDocument.offsetAt(range.start);
  const end = virtualDocument.offsetAt(range.end);
  if (start === end && start === virtualCss.cursor.virtual && virtualCss.cursor.exact) {
    const position = document.positionAt(virtualCss.cursor.source);
    return new Range(position, position);
  }
  return sourceRange(virtualCss.mappings, virtualDocument, document, range);
}

function sourceRange(
  mappings: readonly number[],
  virtualDocument: TextDocument,
  document: TextDocument,
  range: Range,
): Range | undefined {
  const offsets = toSourceRange(
    mappings,
    virtualDocument.offsetAt(range.start),
    virtualDocument.offsetAt(range.end),
  );
  if (!offsets) return undefined;
  return new Range(document.positionAt(offsets[0]), document.positionAt(offsets[1]));
}

class Extension
  implements CompletionItemProvider, HoverProvider, TextDocumentContentProvider, Disposable
{
  // Ref-counted content for the csslit-css scheme. Concurrent requests against the same template
  // share one virtual document, and the content is retained only while a request is using it.
  readonly #virtualDocuments = new Map<string, { content: string; references: number }>();
  readonly #sourceDocumentIds = new WeakMap<TextDocument, number>();
  #nextSourceDocumentId = 0;
  #nextRequestId = 0;
  readonly #output: LogOutputChannel;
  readonly #typeScriptParser: TypescriptParser;
  readonly #typeScriptLegacyParser: TypescriptLegacyParser;

  constructor(output: LogOutputChannel) {
    this.#output = output;
    this.#typeScriptParser = new TypescriptParser(output);
    this.#typeScriptLegacyParser = new TypescriptLegacyParser(output);
  }

  resetParsers(): void {
    this.#typeScriptParser.reset();
  }

  dispose(): void {
    this.#typeScriptParser.dispose();
  }

  async #locateVirtualCss(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Promise<(VirtualCss & { uri: Uri }) | undefined> {
    let documentId = this.#sourceDocumentIds.get(document);
    if (documentId === undefined) {
      documentId = this.#nextSourceDocumentId++;
      this.#sourceDocumentIds.set(document, documentId);
    }
    const documentVersion = document.version;
    const sourceOffset = document.offsetAt(position);
    const configuration = workspace.getConfiguration();
    const nativePreview =
      configuration.get<boolean>("js/ts.experimental.useTsgo") ??
      configuration.get<boolean>("typescript.experimental.useTsgo") ??
      false;
    if (nativePreview && !typeScriptLanguages.has(document.languageId)) return;
    const module = nativePreview
      ? await this.#typeScriptParser.parse(document, position, token)
      : await this.#typeScriptLegacyParser.parse(document, position, token);
    const virtualCss = module && buildVirtualCss(module, sourceOffset);
    if (!virtualCss) return;
    return {
      ...virtualCss,
      uri: Uri.from({
        scheme: CSS_DOCUMENT_SCHEME,
        authority: "embedded",
        path: `/${documentId}/${documentVersion}/${virtualCss.templateStart}.css`,
      }),
    };
  }

  provideTextDocumentContent(uri: Uri): string | undefined {
    return this.#virtualDocuments.get(uri.toString())?.content;
  }

  async #withVirtualDocument<T>(
    virtualCss: { content: string; uri: Uri },
    use: (document: TextDocument) => Promise<T>,
  ): Promise<T> {
    const key = virtualCss.uri.toString();
    let entry = this.#virtualDocuments.get(key);
    if (entry) {
      entry.references++;
    } else {
      entry = { content: virtualCss.content, references: 1 };
      this.#virtualDocuments.set(key, entry);
    }

    try {
      return await use(await workspace.openTextDocument(virtualCss.uri));
    } finally {
      if (--entry.references === 0) this.#virtualDocuments.delete(key);
    }
  }

  async provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    completionContext: CompletionContext,
  ): Promise<CompletionList | undefined> {
    const output = this.#output;
    const requestId = ++this.#nextRequestId;
    const started = performance.now();
    output.trace(
      `[completion ${requestId}] ${document.uri.toString()}:${position.line + 1}:${position.character + 1} version ${document.version}`,
    );
    const virtualCss = await this.#locateVirtualCss(document, position, token);
    if (!virtualCss) {
      output.trace(`[completion ${requestId}] no csslit template`);
      return;
    }
    if (token.isCancellationRequested) {
      output.trace(`[completion ${requestId}] cancelled after locating template`);
      return;
    }
    const trace = output.logLevel === LogLevel.Trace;
    if (trace) {
      output.trace(
        `[completion ${requestId}] ${virtualCss.uri.toString()} offset ${virtualCss.cursor.virtual}, exact ${virtualCss.cursor.exact}, unit suffix ${Boolean(virtualCss.unitSuffix)}\n${JSON.stringify(virtualCss.content)}`,
      );
    }

    try {
      return await this.#withVirtualDocument(virtualCss, async (virtualDocument) => {
        if (token.isCancellationRequested) return;
        const list = await commands.executeCommand<CompletionList>(
          "vscode.executeCompletionItemProvider",
          virtualCss.uri,
          virtualDocument.positionAt(virtualCss.cursor.virtual),
          // The css service only reacts to the trigger characters it knows; the rest of the
          // characters the provider registers for start a fresh completion request instead.
          completionContext.triggerKind === CompletionTriggerKind.TriggerCharacter &&
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
        const sample = trace ? sampleCompletionItems(list.items) : undefined;
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
  }

  async provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Promise<Hover | undefined> {
    try {
      const virtualCss = await this.#locateVirtualCss(document, position, token);
      if (!virtualCss || token.isCancellationRequested) return;

      return await this.#withVirtualDocument(virtualCss, async (virtualDocument) => {
        if (token.isCancellationRequested) return;
        const hovers = await commands.executeCommand<Hover[]>(
          "vscode.executeHoverProvider",
          virtualCss.uri,
          virtualDocument.positionAt(virtualCss.cursor.virtual),
        );
        if (token.isCancellationRequested) return;
        const hover = hovers?.[0];
        if (!hover) return;
        return new Hover(
          hover.contents,
          hover.range && sourceRange(virtualCss.mappings, virtualDocument, document, hover.range),
        );
      });
    } catch (error) {
      this.#output.error("Hover failed", error);
      return;
    }
  }
}

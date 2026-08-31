import {
  window,
  workspace,
  languages,
  extensions,
  CompletionItem,
  CompletionItemKind,
  Range,
  Disposable,
  Position,
  Uri,
  CompletionList,
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
import { createTypescriptParser } from "./typescript-parser.ts";
import { createTypescriptLegacyParser } from "./typescript-legacy-parser.ts";
import { buildVirtualCss, toSourceRange } from "./virtual-css.ts";
import type { ParsedModule } from "./types.ts";
import type { VirtualCss } from "./virtual-css.ts";

const CSS_DOCUMENT_SCHEME = "csslit-css";
const typeScriptLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);
const languageSelector: DocumentSelector = [
  { language: "javascript" },
  { language: "javascriptreact" },
  { language: "typescript" },
  { language: "typescriptreact" },
  // TSRX used `ripple` before switching to `tsrx`; support both extension generations.
  { language: "ripple" },
  { language: "tsrx" },
  { language: "vue" },
  { language: "mdx" },
  { language: "astro" },
];
type Parser = {
  parse(
    document: TextDocument,
    position: Position,
    verifyFrameworkMapping?: boolean,
  ): Promise<ParsedModule | undefined>;
  dispose?(): void;
};

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("csslit", { log: true });
  const extension = new Extension(output);
  context.subscriptions.push(
    output,
    extension,
    workspace.registerTextDocumentContentProvider(CSS_DOCUMENT_SCHEME, extension),
    languages.registerCompletionItemProvider(languageSelector, extension, ".", "/", ":", "-", "@"),
    languages.registerHoverProvider(languageSelector, extension),
    extensions.onDidChange(() => extension.resetParsers()),
    workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("js/ts.experimental.useTsgo") ||
        event.affectsConfiguration("typescript.experimental.useTsgo")
      ) {
        extension.resetParsers();
      }
    }),
  );
  if (__CSSLIT_TESTING__) {
    context.subscriptions.push(
      commands.registerCommand("_csslit.getVirtualCss", async (uri: Uri, position: Position) => {
        const document = await workspace.openTextDocument(uri);
        const module = await extension.parseModule(document, position, true);
        if (!module) return { parsed: false, virtualCss: null };

        const virtualCss = buildVirtualCss(module, document.offsetAt(position));
        if (!virtualCss) return { parsed: true, virtualCss: null };

        const { content, templateStart, mappings, cursor, unitSuffix } = virtualCss;
        return {
          parsed: true,
          virtualCss: { content, templateStart, mappings, cursor, unitSuffix },
        };
      }),
    );
  }
}

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
  readonly #virtualDocuments = new Map<string, { content: string; references: number }>();
  readonly #sourceDocumentIds = new WeakMap<TextDocument, number>();
  #nextSourceDocumentId = 0;
  readonly #output: LogOutputChannel;
  #parser: Promise<Parser | undefined> | undefined;
  #nativePreview: boolean | undefined;

  constructor(output: LogOutputChannel) {
    this.#output = output;
  }

  resetParsers(): void {
    const parser = this.#parser;
    this.#parser = undefined;
    this.#nativePreview = undefined;
    if (parser)
      void parser.then(
        (initialized) => initialized?.dispose?.(),
        () => {},
      );
  }

  dispose(): void {
    this.resetParsers();
  }

  async #locateVirtualCss(
    document: TextDocument,
    position: Position,
  ): Promise<(VirtualCss & { uri: Uri }) | undefined> {
    let documentId = this.#sourceDocumentIds.get(document);
    if (documentId === undefined) {
      documentId = this.#nextSourceDocumentId++;
      this.#sourceDocumentIds.set(document, documentId);
    }
    const documentVersion = document.version;
    const sourceOffset = document.offsetAt(position);
    const module = await this.parseModule(document, position);
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

  async parseModule(
    document: TextDocument,
    position: Position,
    testing?: boolean,
  ): Promise<ParsedModule | undefined> {
    const version = document.version;
    if (this.#nativePreview === undefined) {
      const configuration = workspace.getConfiguration();
      this.#nativePreview =
        configuration.get<boolean>("js/ts.experimental.useTsgo") ??
        configuration.get<boolean>("typescript.experimental.useTsgo") ??
        false;
    }
    if (this.#nativePreview && !typeScriptLanguages.has(document.languageId)) return;

    if (!this.#parser) {
      if (testing === undefined) {
        this.#output.trace(
          this.#nativePreview
            ? "Using TypeScript Native Preview"
            : "Using the TypeScript server plugin",
        );
      }
      this.#parser = this.#nativePreview
        ? createTypescriptParser()
        : Promise.resolve(createTypescriptLegacyParser());
    }
    const parser = await this.#parser;
    const module = await parser?.parse(
      document,
      position,
      __CSSLIT_TESTING__ && testing && !typeScriptLanguages.has(document.languageId),
    );
    if (document.version !== version) {
      if (__CSSLIT_TESTING__ && testing) throw new Error("Document changed while parsing");
      return;
    }
    return module;
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
    const location = `${document.uri.toString()}:${position.line + 1}:${position.character + 1}`;
    try {
      const virtualCss = await this.#locateVirtualCss(document, position);
      if (!virtualCss || token.isCancellationRequested) {
        if (!token.isCancellationRequested) {
          this.#output.trace(`No csslit template at ${location}`);
        }
        return;
      }

      return await this.#withVirtualDocument(virtualCss, async (virtualDocument) => {
        if (token.isCancellationRequested) return;
        const list = await commands.executeCommand<CompletionList>(
          "vscode.executeCompletionItemProvider",
          virtualCss.uri,
          virtualDocument.positionAt(virtualCss.cursor.virtual),
          completionContext.triggerKind === CompletionTriggerKind.TriggerCharacter &&
            (completionContext.triggerCharacter === "/" ||
              completionContext.triggerCharacter === "-" ||
              completionContext.triggerCharacter === ":")
            ? completionContext.triggerCharacter
            : undefined,
        );
        if (token.isCancellationRequested) return;
        let kept = 0;
        for (const item of list.items) {
          if (mapCompletionItem(item, virtualCss, virtualDocument, document)) {
            list.items[kept++] = item;
          }
        }
        list.items.length = kept;
        this.#output.trace(`Provided ${kept} CSS completions at ${location}`);
        return list;
      });
    } catch (error) {
      this.#output.error("Providing CSS completions failed", error);
      return;
    }
  }

  async provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Promise<Hover | undefined> {
    const location = `${document.uri.toString()}:${position.line + 1}:${position.character + 1}`;
    try {
      const virtualCss = await this.#locateVirtualCss(document, position);
      if (!virtualCss || token.isCancellationRequested) {
        if (!token.isCancellationRequested) {
          this.#output.trace(`No csslit template at ${location}`);
        }
        return;
      }

      return await this.#withVirtualDocument(virtualCss, async (virtualDocument) => {
        if (token.isCancellationRequested) return;
        const hovers = await commands.executeCommand<Hover[]>(
          "vscode.executeHoverProvider",
          virtualCss.uri,
          virtualDocument.positionAt(virtualCss.cursor.virtual),
        );
        if (token.isCancellationRequested) return;
        const hover = hovers[0];
        this.#output.trace(
          hover ? `Provided CSS hover at ${location}` : `No CSS hover at ${location}`,
        );
        if (!hover) return;
        return new Hover(
          hover.contents,
          hover.range && sourceRange(virtualCss.mappings, virtualDocument, document, hover.range),
        );
      });
    } catch (error) {
      this.#output.error("Providing CSS hover failed", error);
      return;
    }
  }
}

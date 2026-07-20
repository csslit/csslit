import type { Node, SourceFile, TaggedTemplateExpression } from "typescript/unstable/ast";
import type { API } from "typescript/unstable/async";
import type * as vscode from "vscode";
import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

const TS_EXTENSION_ID = "TypeScriptTeam.native-preview";
type AstModule = typeof import("typescript/unstable/ast");
export type TypeScriptModules = {
  async: typeof import("typescript/unstable/async");
  ast: AstModule;
};

export class StaleSourceFileError extends Error {}

type Connection = { ts: TypeScriptModules; api: API<boolean> };

export class TypeScriptParser implements vscode.Disposable {
  #connection: Connection | undefined;
  #connectionPromise: Promise<Connection | undefined> | undefined;
  #connectionFailed = false;
  readonly #output: vscode.LogOutputChannel;
  readonly #vscode: Pick<typeof vscode, "commands" | "extensions">;

  constructor(
    output: vscode.LogOutputChannel,
    host: Pick<typeof vscode, "commands" | "extensions">,
  ) {
    this.#output = output;
    this.#vscode = host;
  }

  async parse(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<ParsedModule | undefined> {
    const version = document.version;
    const source = document.getText();
    const connection = await this.#getConnection();
    if (!connection) return;

    let refresh = false;
    for (;;) {
      try {
        const module = await parseModule(
          connection.ts,
          connection.api,
          document.uri.toString(),
          source,
          refresh,
        );
        return document.version === version ? module : undefined;
      } catch (error) {
        if (error instanceof StaleSourceFileError && !refresh) {
          this.#output.debug(`Waiting for tsgo to reach document version ${version}`);
          try {
            await this.#vscode.commands.executeCommand(
              "vscode.executeSelectionRangeProvider",
              document.uri,
              [position],
            );
          } catch (syncError) {
            this.#output.error("Synchronizing with tsgo failed", syncError);
            return;
          }
          if (token.isCancellationRequested || document.version !== version) return;
          refresh = true;
          continue;
        }
        this.#invalidateConnection(connection);
        this.#output.error("Locating templates with TypeScript 7 failed", error);
        return;
      }
    }
  }

  reset(): void {
    this.#connectionFailed = false;
    this.#connectionPromise = undefined;
    if (!this.#connection) return;
    const previous = this.#connection;
    this.#connection = undefined;
    void previous.api.close().catch((error) => this.#output.trace("Closing connection", error));
  }

  dispose(): void {
    if (this.#connection) void this.#connection.api.close();
    else void this.#connectionPromise?.then((result) => result?.api.close());
  }

  #getConnection(): Promise<Connection | undefined> {
    if (this.#connection) return Promise.resolve(this.#connection);
    if (this.#connectionPromise) return this.#connectionPromise;
    if (this.#connectionFailed) return Promise.resolve(undefined);
    let latchFailure = false;
    const attempt = (async () => {
      const extension = this.#vscode.extensions.getExtension(TS_EXTENSION_ID);
      if (!extension) {
        latchFailure = true;
        return;
      }
      try {
        const extensionApi = (await extension.activate()) as
          | { initializeAPIConnection?: () => Promise<string> }
          | undefined;
        const pipe = await extensionApi?.initializeAPIConnection?.();
        if (typeof pipe !== "string") {
          latchFailure = true;
          return;
        }
        const ts = await loadTypeScript();
        const api = await ts.async.API.fromLSPConnection({ pipe });
        this.#output.info("Connected to the TypeScript API session");
        return { ts, api };
      } catch (error) {
        this.#output.error("Connecting to the TypeScript 7 API session failed", error);
        return;
      }
    })();
    this.#connectionPromise = attempt;
    void attempt.then((result) => {
      if (this.#connectionPromise !== attempt) {
        if (result)
          void result.api
            .close()
            .catch((error) => this.#output.trace("Closing obsolete connection", error));
        return;
      }
      this.#connectionPromise = undefined;
      this.#connection = result;
      this.#connectionFailed = !result && latchFailure;
    });
    return attempt;
  }

  #invalidateConnection(failed: Connection): void {
    if (this.#connection !== failed) return;
    this.#connection = undefined;
    void failed.api
      .close()
      .catch((error) => this.#output.trace("Closing failed connection", error));
  }
}

export async function loadTypeScript(): Promise<TypeScriptModules> {
  const [async, ast] = await Promise.all([
    import("typescript/unstable/async"),
    import("typescript/unstable/ast"),
  ]);
  return { async, ast };
}

export async function parseModule(
  ts: TypeScriptModules,
  api: API<boolean>,
  uri: string,
  expectedSource: string,
  refresh = false,
): Promise<ParsedModule | undefined> {
  const opened = await api.updateSnapshot({ openFiles: [{ uri }] });
  if (refresh) api.clearSourceFileCache();
  let sourceFile: SourceFile | undefined;
  try {
    const project = await opened.getDefaultProjectForFile({ uri });
    sourceFile = await project?.program.getSourceFile({ uri });
  } finally {
    const closed = await api.updateSnapshot({ closeFiles: [{ uri }] });
    await closed.dispose();
    await opened.dispose();
  }
  if (!sourceFile) return;
  if (sourceFile.text !== expectedSource) {
    throw new StaleSourceFileError("tsgo and VS Code have different document contents");
  }
  return { source: sourceFile.text, templates: collectTemplates(ts.ast, sourceFile) };
}

function collectTemplates(ast: AstModule, sourceFile: SourceFile): CssTemplate[] {
  const templates: CssTemplate[] = [];
  const visit = (node: Node) => {
    if (ast.isTaggedTemplateExpression(node)) {
      const global = cssTagKind(ast, node);
      if (global !== undefined) templates.push(templateFromAst(ast, sourceFile, node, global));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return templates;
}

function cssTagKind(ast: AstModule, node: TaggedTemplateExpression): boolean | undefined {
  if (ast.isIdentifier(node.tag) && node.tag.text === "css") return false;
  if (
    ast.isPropertyAccessExpression(node.tag) &&
    ast.isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "css" &&
    node.tag.name.text === "global"
  )
    return true;
  return undefined;
}

function templateFromAst(
  ast: AstModule,
  sourceFile: SourceFile,
  node: TaggedTemplateExpression,
  global: boolean,
): CssTemplate {
  const source = sourceFile.text;
  const template = node.template;
  const quasis: CssQuasi[] = [];
  const push = (start: number, end: number, cooked: string) => {
    quasis.push({ start, end, cooked });
  };
  if (ast.isNoSubstitutionTemplateLiteral(template)) {
    const start = template.getStart(sourceFile) + 1;
    push(start, templateContentEnd(source, template.end), template.text);
  } else if (ast.isTemplateExpression(template)) {
    push(template.head.getStart(sourceFile) + 1, template.head.end - 2, template.head.text);
    for (const span of template.templateSpans) {
      const start = span.literal.getStart(sourceFile) + 1;
      push(
        start,
        span.literal.kind === ast.SyntaxKind.TemplateTail
          ? templateContentEnd(source, span.literal.end)
          : span.literal.end - 2,
        span.literal.text,
      );
    }
  } else {
    throw new Error("Unexpected template node");
  }
  return { global, quasis };
}

function templateContentEnd(source: string, end: number): number {
  if (source.charCodeAt(end - 1) !== 96) return end;
  let backslashes = 0;
  while (source.charCodeAt(end - 2 - backslashes) === 92) backslashes++;
  return backslashes % 2 === 0 ? end - 1 : end;
}

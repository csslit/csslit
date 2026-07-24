import { Position, commands, CodeAction, Range, WorkspaceEdit } from "vscode";
import type { LogOutputChannel, TextDocument, CancellationToken, Command } from "vscode";
import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

export class TypescriptLegacyParser {
  readonly #output: LogOutputChannel;

  constructor(output: LogOutputChannel) {
    this.#output = output;
  }

  async parse(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Promise<ParsedModule | undefined> {
    const version = document.version;
    const module = await this.#request(document, position);
    if (token.isCancellationRequested || document.version !== version) return;
    return module;
  }

  async #request(document: TextDocument, position: Position): Promise<ParsedModule | undefined> {
    try {
      const actions = await commands.executeCommand<(CodeAction | Command)[]>(
        "vscode.executeCodeActionProvider",
        document.uri,
        new Range(position, position),
        "refactor.csslit.findTemplates",
        1,
      );
      const action = actions?.find(
        (candidate): candidate is CodeAction =>
          "kind" in candidate && candidate.kind?.value === "refactor.csslit.findTemplates",
      );
      if (!action?.edit) return;
      const module = parsedModuleFromWorkspaceEdit(document, action.edit);
      if (module)
        this.#output.debug(
          `Located ${module.templates.length} templates through the TypeScript plugin`,
        );
      return module;
    } catch (error) {
      this.#output.error("Locating templates through the TypeScript plugin failed", error);
      return;
    }
  }
}

export function parsedModuleFromWorkspaceEdit(
  document: TextDocument,
  workspaceEdit: WorkspaceEdit,
): ParsedModule | undefined {
  const templates: CssTemplate[] = [];

  for (const [, edits] of workspaceEdit.entries()) {
    for (const edit of edits) {
      const metadata = JSON.parse(edit.newText) as {
        template: number;
        quasi: number;
        quasis: number;
        global: boolean;
        cooked: string;
      };
      let template = templates[metadata.template];
      if (!template) {
        template = { global: metadata.global, quasis: new Array<CssQuasi>(metadata.quasis) };
        templates[metadata.template] = template;
      } else if (
        template.global !== metadata.global ||
        template.quasis.length !== metadata.quasis
      ) {
        throw new Error("Inconsistent template metadata");
      }
      if (metadata.quasi < 0 || metadata.quasi >= template.quasis.length)
        throw new Error("Inconsistent template metadata");
      template.quasis[metadata.quasi] = {
        start: document.offsetAt(edit.range.start),
        end: document.offsetAt(edit.range.end),
        cooked: metadata.cooked,
      };
    }
  }

  if (templates.length === 0) return;
  for (let index = 0; index < templates.length; index++) {
    const template = templates[index];
    if (!template) throw new Error("Incomplete template mapping");
    for (let quasi = 0; quasi < template.quasis.length; quasi++) {
      if (!template.quasis[quasi]) throw new Error("Incomplete template mapping");
    }
  }
  return { source: document.getText(), templates };
}

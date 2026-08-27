import { commands, Position } from "vscode";
import type { TextDocument } from "vscode";
import { parsedModuleFromEdits } from "./parsed-module.ts";
import type { ParsedModule } from "./types.ts";

type TextChange = {
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  newText: string;
};

type FindTemplatesResponse =
  | {
      success: true;
      body: {
        answered: boolean;
        edits: { fileName: string; textChanges: TextChange[] }[];
        frameworkMapped?: boolean;
      };
    }
  | { success: false; message: string }
  | undefined;

export function createTypescriptLegacyParser() {
  return {
    async parse(
      document: TextDocument,
      position: Position,
      verifyFrameworkMapping?: boolean,
    ): Promise<ParsedModule | undefined> {
      const request: {
        file: typeof document.uri;
        line: number;
        offset: number;
        verifyFrameworkSource?: string;
      } = {
        file: document.uri,
        line: position.line + 1,
        offset: position.character + 1,
      };
      if (__CSSLIT_TESTING__ && verifyFrameworkMapping) {
        request.verifyFrameworkSource = document.getText();
      }
      const response = await commands.executeCommand<FindTemplatesResponse>(
        "typescript.tsserverRequest",
        "_csslit:findTemplates",
        request,
        { isAsync: true, lowPriority: false },
      );

      if (!response?.success) {
        throw new Error(response?.message ?? "TypeScript request failed");
      }

      if (
        __CSSLIT_TESTING__ &&
        verifyFrameworkMapping &&
        response.body.answered &&
        response.body.frameworkMapped !== true
      ) {
        throw new Error("Language integration did not map source");
      }

      if (!response.body.answered) return;

      const edits = response.body.edits.flatMap(({ textChanges }) =>
        textChanges.map(({ start, end, newText }) => ({
          start: document.offsetAt(new Position(start.line - 1, start.offset - 1)),
          end: document.offsetAt(new Position(end.line - 1, end.offset - 1)),
          newText,
        })),
      );

      if (edits.length === 0) {
        return { source: document.getText(), templates: [] };
      }

      return parsedModuleFromEdits(document.getText(), edits);
    },
  };
}

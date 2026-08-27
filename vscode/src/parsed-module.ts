import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

type ParsedModuleEdit = {
  start: number;
  end: number;
  newText: string;
};

export function parsedModuleFromEdits(
  source: string,
  edits: readonly ParsedModuleEdit[],
): ParsedModule | undefined {
  const templates: CssTemplate[] = [];

  for (const edit of edits) {
    const metadata = JSON.parse(edit.newText) as {
      template: number;
      quasi: number;
      quasis: number;
      global: boolean;
      cooked: string;
    };
    const template = (templates[metadata.template] ??= {
      global: metadata.global,
      quasis: new Array<CssQuasi>(metadata.quasis),
    });
    template.quasis[metadata.quasi] = {
      start: edit.start,
      end: edit.end,
      cooked: metadata.cooked,
    };
  }

  if (templates.length === 0) return;
  return { source, templates };
}

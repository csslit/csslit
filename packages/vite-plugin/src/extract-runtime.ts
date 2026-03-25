type SourceLocation = {
  source: string;
  line: number;
  column: number;
  content: string | null;
};

type CssBlock = {
  quasis?: (SourceLocation | null)[] | null;
  expressions?: (SourceLocation | null)[] | null;
};

export type ExtractedCssResult = {
  block: CssBlock | null;
  strings: TemplateStringsArray;
  values: unknown[];
};

export function createCsslitExtractRuntime(block: CssBlock | null) {
  return (strings: TemplateStringsArray, ...values: unknown[]): ExtractedCssResult => ({
    block,
    strings,
    values,
  });
}

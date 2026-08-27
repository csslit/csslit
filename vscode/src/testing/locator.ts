import { toSourceRange } from "../virtual-css.ts";
import type { VirtualCss } from "../virtual-css.ts";

export interface TemplateLocator {
  virtualCss(source: string, offset: number): Promise<VirtualCss | undefined>;
  [Symbol.asyncDispose](): Promise<void>;
}

export class NoTypeScriptResponse extends Error {}

export async function virtualCssFor(
  locator: TemplateLocator,
  sourceWithCaret: string,
): Promise<string> {
  const offset = sourceWithCaret.indexOf("|");
  if (offset === -1 || sourceWithCaret.indexOf("|", offset + 1) !== -1) {
    throw new Error("source must contain exactly one caret");
  }
  const source = sourceWithCaret.slice(0, offset) + sourceWithCaret.slice(offset + 1);

  let virtualCss: VirtualCss | undefined;
  try {
    virtualCss = await locator.virtualCss(source, offset);
  } catch (error) {
    if (error instanceof NoTypeScriptResponse) return "no TypeScript implementation answered";
    throw error;
  }
  if (!virtualCss) return "no template at offset";

  const { content, mappings, cursor, unitSuffix, templateStart } = virtualCss;
  const verbatim = new Uint8Array(content.length);
  for (let index = 0; index < mappings.length; index += 3) {
    const start = mappings[index]!;
    const length = mappings[index + 2]!;
    verbatim.fill(1, start, start + length);
  }

  let out = "";
  let synthetic = false;
  for (let index = 0; index < content.length; index++) {
    if (index === cursor.virtual) out += "|";
    const isSynthetic = verbatim[index] === 0;
    if (isSynthetic !== synthetic) {
      out += isSynthetic ? "«" : "»";
      synthetic = isSynthetic;
    }
    out += content[index];
  }
  if (synthetic) out += "»";
  if (cursor.virtual === content.length) out += "|";

  const parts = [
    `source +${cursor.source - templateStart}`,
    `virtual ${cursor.virtual}`,
    `exact ${cursor.exact}`,
  ];
  if (unitSuffix) {
    parts.push(
      `unitSuffix ${unitSuffix.virtualStart}..${unitSuffix.virtualEnd} -> +${unitSuffix.sourceStart - templateStart}`,
    );
  }

  let start = cursor.virtual;
  while (start > 0 && /[\w-]/.test(content[start - 1]!)) start--;
  let end = cursor.virtual;
  while (end < content.length && /[\w-]/.test(content[end]!)) end++;

  const range = toSourceRange(mappings, start, end);
  parts.push(
    range ? `edits +${range[0] - templateStart}..+${range[1] - templateStart}` : "edits none",
  );
  return `${out}\n---\n${parts.join(", ")}`;
}

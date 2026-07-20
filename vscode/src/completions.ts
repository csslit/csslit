import * as vscode from "vscode";
import { toSourceRange } from "./virtual-css.ts";
import type { VirtualCss } from "./virtual-css.ts";

export function mapCompletionItem(
  item: vscode.CompletionItem,
  virtualCss: VirtualCss,
  virtualDocument: vscode.TextDocument,
  document: vscode.TextDocument,
): boolean {
  let hasPrimaryEdit = false;

  if (virtualCss.unitSuffix) {
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

    const range = new vscode.Range(
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
  } else if (item.range instanceof vscode.Range) {
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
      virtualDocument.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
    const inserting = new vscode.Range(replacing.start, position);
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
  virtualDocument: vscode.TextDocument,
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range | undefined {
  const start = virtualDocument.offsetAt(range.start);
  const end = virtualDocument.offsetAt(range.end);
  if (start === end && start === virtualCss.cursor.virtual && virtualCss.cursor.exact) {
    const position = document.positionAt(virtualCss.cursor.source);
    return new vscode.Range(position, position);
  }
  return sourceRange(virtualCss.mappings, virtualDocument, document, range);
}

export function sourceRange(
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

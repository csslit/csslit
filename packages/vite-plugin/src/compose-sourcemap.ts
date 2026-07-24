import {
  GenMapping,
  maybeAddSegment,
  setSourceContent,
  toEncodedMap,
} from "@jridgewell/gen-mapping";
import type { EncodedSourceMap } from "@jridgewell/gen-mapping";
import { TraceMap, decodedMappings, eachMapping } from "@jridgewell/trace-mapping";
import type { SourceMapInput } from "@jridgewell/trace-mapping";

/**
 * Composes the compiled CSS map onto the source module's own map.
 *
 * Generic remapping only matches segments on the traced position's exact generated line, but
 * lowering plugins (like TSRX) map only the code they rewrite, so the untouched lines of a css
 * template carry no segments at all and every position in them would be dropped. Such transforms
 * copy the template contents verbatim, which makes the nearest earlier segment a sound anchor:
 * trace through it and reapply the traced position's distance from it.
 */
export function composeCssSourcemap(
  cssMap: SourceMapInput,
  sourceMap: SourceMapInput,
): EncodedSourceMap {
  const css = new TraceMap(cssMap);
  const source = new TraceMap(sourceMap);
  const sourceMappings = decodedMappings(source);
  const gen = new GenMapping({ file: css.file ?? undefined });

  eachMapping(css, (mapping) => {
    if (mapping.originalLine === null) return;
    const targetLine = mapping.originalLine - 1;
    const targetColumn = mapping.originalColumn;

    let segment = null;
    let segmentLine = Math.min(targetLine, sourceMappings.length - 1);
    for (; segmentLine >= 0; segmentLine--) {
      const segments = sourceMappings[segmentLine]!;
      if (segmentLine === targetLine) {
        for (const candidate of segments) {
          if (candidate[0] > targetColumn) break;
          segment = candidate;
        }
      } else if (segments.length > 0) {
        segment = segments[segments.length - 1]!;
      }
      if (segment) break;
    }
    // A sourceless anchor marks content the transform inserted; the distance across it does not
    // carry over to the original file.
    if (!segment || segment.length === 1) return;

    const sourceIndex = segment[1];
    const line = segment[2] + (targetLine - segmentLine);
    const column =
      segmentLine === targetLine ? segment[3] + (targetColumn - segment[0]) : targetColumn;

    const name = source.sources[sourceIndex]!;
    maybeAddSegment(gen, mapping.generatedLine - 1, mapping.generatedColumn, name, line, column);
    const content = source.sourcesContent?.[sourceIndex];
    if (content != null) setSourceContent(gen, name, content);
  });

  return toEncodedMap(gen);
}

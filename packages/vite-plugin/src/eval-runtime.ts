import type {
  Dependency,
  DiagnosticPredicateCode,
  ExpressionCode,
  EvalDiagnostic,
  Span,
} from "./eval-error";

interface StepDiagnosticInfo {
  kind: "dependency";
  name: string;
  reference: string;
  source: string;
}

interface VariableIssueDiagnosticInfo {
  kind: "variable";
  name: string;
  predicate: DiagnosticPredicateCode;
  reference: string;
  source: string;
}

interface ExpressionIssueDiagnosticInfo {
  kind: "expression";
  code: ExpressionCode;
  source: string;
}

type IssueDiagnosticInfo = VariableIssueDiagnosticInfo | ExpressionIssueDiagnosticInfo;

type DiagnosticInfo = StepDiagnosticInfo | IssueDiagnosticInfo;

class EvaluationError extends Error {
  diagnostic: DiagnosticInfo;

  constructor(diagnostic: DiagnosticInfo) {
    super("CSS literal evaluation failed.");
    this.diagnostic = diagnostic;
  }
}

function decodeLocationToken(token: string): Span {
  const [line, column, endLine, endColumn] = token.split(":", 4);
  return {
    start: {
      row: parseInt(line, 10),
      col: parseInt(column, 10),
    },
    end: {
      row: parseInt(endLine, 10),
      col: parseInt(endColumn, 10),
    },
  };
}

function buildCsslitDiagnosticData(error: unknown, interpolation: string): EvalDiagnostic {
  const interpolationLocation = decodeLocationToken(interpolation);
  let current: unknown = error;
  const dependencies: Dependency[] = [];
  let rootCauseSource = interpolationLocation;

  if (current instanceof EvaluationError && current.diagnostic.kind === "dependency") {
    const diagnostic = current.diagnostic;

    rootCauseSource = decodeLocationToken(diagnostic.source);
    dependencies.push({
      name: diagnostic.name,
      reference: decodeLocationToken(diagnostic.reference),
    });

    current = current.cause;
  }

  while (current instanceof EvaluationError) {
    const diagnostic = current.diagnostic;

    switch (diagnostic.kind) {
      case "dependency": {
        rootCauseSource = decodeLocationToken(diagnostic.source);
        dependencies.push({
          name: diagnostic.name,
          reference: decodeLocationToken(diagnostic.reference),
        });
        break;
      }
      case "variable": {
        return {
          dependencies,
          interpolation: interpolationLocation,
          rootCause: {
            kind: "variable",
            name: diagnostic.name,
            predicate: diagnostic.predicate,
            reference: decodeLocationToken(diagnostic.reference),
            source: decodeLocationToken(diagnostic.source),
          },
        };
      }
      case "expression": {
        return {
          dependencies,
          interpolation: interpolationLocation,
          rootCause: {
            kind: "expression",
            code: diagnostic.code,
            source: decodeLocationToken(diagnostic.source),
          },
        };
      }
      default:
        throw new Error(`Unsupported csslit diagnostic info: ${JSON.stringify(diagnostic)}`);
    }

    current = current.cause;
  }

  let text: string;
  try {
    text = String(current);
  } catch {
    text = "<unstringifiable thrown value>";
  }

  return {
    dependencies,
    interpolation: interpolationLocation,
    rootCause: {
      kind: "thrown",
      source: rootCauseSource,
      text,
      stack: current instanceof Error ? current.stack : undefined,
    },
  };
}

export function init() {
  const blocks: {
    className: string;
    patchLines: number[];
    strings: TemplateStringsArray;
    values: unknown[];
  }[] = [];
  const deferred: Array<() => void> = [];
  const errors: EvalDiagnostic[] = [];

  function varErr(
    name: string,
    predicate: DiagnosticPredicateCode,
    loc: string,
    source?: string,
  ): never {
    if (source !== undefined) {
      const issueError = new EvaluationError({
        kind: "variable",
        name,
        predicate,
        reference: source,
        source,
      });

      const error = new EvaluationError({
        kind: "dependency",
        name,
        reference: loc,
        source,
      });
      error.cause = issueError;
      throw error;
    }

    throw new EvaluationError({
      kind: "variable",
      name,
      predicate,
      reference: loc,
      source: loc,
    });
  }

  function exprErr(code: ExpressionCode, loc: string): never {
    throw new EvaluationError({
      kind: "expression",
      code,
      source: loc,
    });
  }

  function cell<T>(name: string, loc: string, factory: () => T) {
    try {
      const value = factory();
      return () => value;
    } catch (error) {
      return (useLoc: string) => {
        const dependencyError = new EvaluationError({
          kind: "dependency",
          name,
          reference: useLoc,
          source: loc,
        });
        dependencyError.cause = error;
        throw dependencyError;
      };
    }
  }

  function cellVarErr(name: string, predicate: DiagnosticPredicateCode, loc: string) {
    return (useLoc: string) => {
      const issueError = new EvaluationError({
        kind: "variable",
        name,
        predicate,
        reference: loc,
        source: loc,
      });

      const error = new EvaluationError({
        kind: "dependency",
        name,
        reference: useLoc,
        source: loc,
      });
      error.cause = issueError;
      throw error;
    };
  }

  function cellExprErr(name: string, code: ExpressionCode, loc: string) {
    return (useLoc: string) => {
      const issueError = new EvaluationError({
        kind: "expression",
        code,
        source: loc,
      });

      const error = new EvaluationError({
        kind: "dependency",
        name,
        reference: useLoc,
        source: loc,
      });
      error.cause = issueError;
      throw error;
    };
  }

  function readCell<T>(
    name: string,
    maybeCell: ((useLoc: string) => T) | undefined,
    useLoc: string,
    initLoc: string,
  ) {
    if (maybeCell === undefined) {
      return varErr(name, "used-before-initializer", useLoc, initLoc);
    }

    return maybeCell(useLoc);
  }

  function capture(loc: string, expression: () => unknown) {
    try {
      return String(expression());
    } catch (error) {
      errors.push(buildCsslitDiagnosticData(error, loc));
      return `/* csslit error ${errors.length} */`;
    }
  }

  function css(className: string, patchLines: number[] = []) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      blocks.push({ className, patchLines, strings, values });
    };
  }

  function defer(task: () => void) {
    deferred.push(task);
  }

  function finalize(map: { mappings: string } | null) {
    while (deferred.length > 0) {
      deferred.shift()!();
    }

    let code = "";
    const mappings = map?.mappings ?? "";
    let patchedMappings = "";
    let mappingCursor = 0;
    let mappingLine = 0;
    let baselineLine = 0;

    for (const block of blocks) {
      const blockStartLine = baselineLine;
      let blockEndsWithNewline = false;

      code += `.${block.className} {`;

      if (!block.strings[0].startsWith("\n")) {
        code += "\n";
        if (map) {
          baselineLine += 1;
        }
        blockEndsWithNewline = true;
      }

      for (let i = 0; i < block.strings.length; i += 1) {
        const string = block.strings[i];
        code += string;
        if (map) {
          baselineLine += string.match(/\r\n?|\n/g)?.length ?? 0;
        }
        if (string.length > 0) {
          blockEndsWithNewline = string.endsWith("\n");
        }

        if (i >= block.values.length) {
          continue;
        }

        const value = String(block.values[i]);
        code += value;

        if (value.length > 0) {
          blockEndsWithNewline = value.endsWith("\n");
        }
        const line = block.patchLines[i];

        if (map) {
          const count = value.match(/\r\n?|\n/g)?.length ?? 0;

          if (count > 0) {
            const patchLine = blockStartLine + line;

            while (mappingLine < patchLine) {
              const end = mappings.indexOf(";", mappingCursor);
              if (end === -1) {
                patchedMappings += mappings.slice(mappingCursor);
                mappingCursor = mappings.length;
                break;
              }

              patchedMappings += mappings.slice(mappingCursor, end + 1);
              mappingCursor = end + 1;
              mappingLine += 1;
            }

            if (mappingLine === patchLine) {
              patchedMappings += ";".repeat(count);
            }
          }
        }
      }

      if (!blockEndsWithNewline) {
        code += "\n";
        if (map) {
          baselineLine += 1;
        }
      }

      code += "}\n\n";
      if (map) {
        baselineLine += 2;
      }
    }

    return {
      code,
      errors,
      map: map ? { ...map, mappings: patchedMappings + map.mappings.slice(mappingCursor) } : null,
    };
  }

  return {
    cell,
    cellExprErr,
    cellVarErr,
    capture,
    css,
    defer,
    exprErr,
    finalize,
    readCell,
    varErr,
  };
}

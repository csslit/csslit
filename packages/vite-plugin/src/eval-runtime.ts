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

interface Cell<T> {
  (useLoc: string): T;
  readonly initialized: boolean;
  value: T;
  error: unknown;
}

class CellInitializationError extends Error {}

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
  const blocks: Array<
    | {
        kind: "scoped";
        scopedName: string;
        code: string;
        mappingRuns?: number[];
      }
    | {
        kind: "global";
        code: string;
        mappingRuns?: number[];
      }
  > = [];
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

  function cell<T>(name: string, loc: string, factory?: () => T) {
    let state:
      | { kind: "uninitialized" }
      | { kind: "value"; value: T }
      | { kind: "error"; error: unknown } = { kind: "uninitialized" };
    const read = ((useLoc: string) => {
      switch (state.kind) {
        case "uninitialized":
          return varErr(name, "used-before-initializer", useLoc, loc);
        case "value":
          return state.value;
        case "error": {
          const dependencyError = new EvaluationError({
            kind: "dependency",
            name,
            reference: useLoc,
            source: loc,
          });
          dependencyError.cause = state.error;
          throw dependencyError;
        }
      }
    }) as Cell<T>;

    Object.defineProperties(read, {
      initialized: {
        get() {
          return state.kind !== "uninitialized";
        },
      },
      value: {
        set(value: T) {
          if (state.kind !== "uninitialized") {
            throw new CellInitializationError(`Cell ${name} was initialized more than once.`);
          }
          state = { kind: "value", value };
        },
      },
      error: {
        set(error: unknown) {
          if (state.kind !== "uninitialized") {
            throw new CellInitializationError(`Cell ${name} was initialized more than once.`);
          }
          state = { kind: "error", error };
        },
      },
    });

    if (factory !== undefined) {
      try {
        read.value = factory();
      } catch (error) {
        read.error = error;
      }
    }

    return read;
  }

  function destructure(cells: Array<Cell<unknown>>, run: () => void) {
    try {
      run();
    } catch (error) {
      if (error instanceof CellInitializationError) throw error;
      for (const cell of cells) {
        if (!cell.initialized) cell.error = error;
      }
    }
  }

  function cellVarErr(name: string, predicate: DiagnosticPredicateCode, loc: string) {
    const result = cell(name, loc);
    result.error = new EvaluationError({
      kind: "variable",
      name,
      predicate,
      reference: loc,
      source: loc,
    });
    return result;
  }

  function cellExprErr(name: string, code: ExpressionCode, loc: string) {
    const result = cell(name, loc);
    result.error = new EvaluationError({
      kind: "expression",
      code,
      source: loc,
    });
    return result;
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

  function materialize(
    strings: TemplateStringsArray,
    values: unknown[],
    quasiLocations: number[] | undefined,
  ) {
    let code = "";
    const mappingRuns: number[] | undefined = quasiLocations === undefined ? undefined : [];
    const mappingBoundaries = /[\\\f\n\u2028\u2029]/g;
    const requiresSlowMapping = /[\f\u2028\u2029]/;

    for (let i = 0; i < strings.length; i += 1) {
      const cooked = strings[i]!;
      const raw = strings.raw[i];
      if (cooked === undefined) {
        throw new Error("Invalid template escape sequence");
      }
      code += cooked;

      let interpolationRow = 0;
      let interpolationCol = 0;
      if (mappingRuns !== undefined) {
        let row = quasiLocations![i * 2];
        let col = quasiLocations![i * 2 + 1];

        if (raw === cooked && !requiresSlowMapping.test(raw)) {
          if (cooked.length > 0) {
            mappingRuns.push(cooked.length * 2, row, col);
          }

          let lineStart = 0;
          let newline: number;
          while ((newline = raw.indexOf("\n", lineStart)) !== -1) {
            row += 1;
            col = 0;
            lineStart = newline + 1;
          }
          col += raw.length - lineStart;
        } else {
          let rawIndex = 0;

          mappingBoundaries.lastIndex = 0;
          while (mappingBoundaries.test(raw)) {
            const start = mappingBoundaries.lastIndex - 1;
            const identityLength = start - rawIndex;
            if (identityLength > 0) {
              mappingRuns.push(identityLength * 2, row, col);
            }
            col += identityLength;

            if (raw.charCodeAt(start) !== 0x5c) {
              mappingRuns.push(3, row, col);
              if (raw.charCodeAt(start) === 0x0c) {
                col += 1;
              } else {
                row += 1;
                col = 0;
              }
              rawIndex = start + 1;
              continue;
            }

            let end = start + 2;
            let cookedLength = 1;
            switch (raw.charCodeAt(start + 1)) {
              case 0x0a:
              case 0x2028:
              case 0x2029:
                row += 1;
                col = 0;
                rawIndex = end;
                mappingBoundaries.lastIndex = rawIndex;
                continue;
              case 0x78:
                end += 2;
                break;
              case 0x75:
                if (raw.charCodeAt(start + 2) === 0x7b) {
                  end = raw.indexOf("}", start + 3) + 1;
                  cookedLength =
                    Number.parseInt(raw.slice(start + 3, end - 1), 16) > 0xffff ? 2 : 1;
                } else {
                  end += 4;
                }
                break;
              default:
                if (raw.codePointAt(start + 1)! > 0xffff) {
                  end += 1;
                  cookedLength = 2;
                }
            }

            mappingRuns.push(cookedLength * 2 + 1, row, col);
            col += end - start;
            rawIndex = end;
            mappingBoundaries.lastIndex = end;
          }

          const identityLength = raw.length - rawIndex;
          if (identityLength > 0) {
            mappingRuns.push(identityLength * 2, row, col);
          }
          col += identityLength;
        }

        interpolationRow = row;
        interpolationCol = col;
      }

      if (i < strings.length - 1) {
        const value = String(values[i]);
        code += value;
        if (mappingRuns !== undefined && value.length > 0) {
          mappingRuns.push(value.length * 2 + 1, interpolationRow, interpolationCol);
        }
      }
    }

    return { code, mappingRuns };
  }

  function css(scopedName: string, quasiLocations?: number[]) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const { code, mappingRuns } = materialize(strings, values, quasiLocations);
      blocks.push({
        kind: "scoped",
        code,
        mappingRuns,
        scopedName,
      });
    };
  }

  function globalCss(quasiLocations?: number[]) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const { code, mappingRuns } = materialize(strings, values, quasiLocations);
      blocks.push({
        kind: "global",
        code,
        mappingRuns,
      });
    };
  }

  function defer(task: () => void) {
    deferred.push(task);
  }

  function finalize(_map: { mappings: string } | null) {
    while (deferred.length > 0) {
      deferred.shift()!();
    }

    return {
      blocks,
      errors,
    };
  }

  return {
    cell,
    cellExprErr,
    cellVarErr,
    capture,
    css,
    defer,
    destructure,
    set discard(_value: unknown) {},
    exprErr,
    finalize,
    globalCss,
    readCell,
    varErr,
  };
}

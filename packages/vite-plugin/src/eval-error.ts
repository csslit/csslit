export type CsslitEvalLocationToken = string;

export type CsslitEvalLocation = {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

type CsslitInputLocation = {
  file?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

type CsslitBuiltErrorLocation = {
  file: string;
  line: number;
  column: number;
};

export type CsslitBuiltError =
  | {
      kind: "generic";
      loc?: CsslitBuiltErrorLocation;
      message: string;
      name?: string;
      stack?: string;
    }
  | {
      frame?: string;
      kind: "csslit";
      loc?: CsslitBuiltErrorLocation;
      message: string;
      name?: string;
      stack?: string;
    };

export type CsslitErrorOptions = {
  fallbackFile?: string;
  ignoreStackFrameFile?: (file: string) => boolean;
  normalizeFile?: (file: string) => string;
  normalizeStackText?: (stackText: string | undefined) => string | undefined;
  readSource?: (file: string) => string | undefined;
};

type CsslitDiagnosticPredicate =
  | { code: "runtime-parameter" }
  | { code: "function-binding" }
  | { code: "class-binding" }
  | { code: "catch-binding" }
  | { code: "reassigned" }
  | { code: "destructured" }
  | { code: "defaulted-binding-pattern" }
  | { code: "unknown-binding-pattern" }
  | { code: "loop-binding" }
  | { code: "no-initializer" }
  | { code: "enum-declaration" }
  | { code: "enum-member" }
  | { code: "namespace-declaration" }
  | { code: "unknown-local-binding-kind" }
  | { code: "not-value-binding" }
  | { code: "not-extracted-scope" }
  | { code: "circular-dependency" }
  | { code: "used-before-initializer" }
  | { code: "unsupported" };

export type CsslitDiagnosticPredicateCode = CsslitDiagnosticPredicate["code"];

export type CsslitExpressionCode =
  | "delete-expression"
  | "call-expression"
  | "private-field"
  | "array-expression"
  | "arrow-function"
  | "assignment-expression"
  | "await-expression"
  | "class-expression"
  | "function-expression"
  | "import-expression"
  | "new-expression"
  | "object-expression"
  | "sequence-expression"
  | "tagged-template"
  | "update-expression"
  | "yield-expression"
  | "private-in-expression"
  | "jsx"
  | "unsupported-expression";

export type CsslitChainSubject = { name: string };

export type CsslitIssue =
  | {
      kind: "variable";
      name: string;
      predicate: CsslitDiagnosticPredicateCode;
    }
  | {
      kind: "expression";
      code: CsslitExpressionCode;
    };

const CSSLIT_DIAGNOSTIC = Symbol("csslitDiagnostic");

type CsslitStepDiagnosticInfo = {
  kind: "step";
  loc: CsslitInputLocation;
  rootLoc?: CsslitInputLocation;
  subject: CsslitChainSubject;
};

type CsslitIssueDiagnosticInfo = {
  kind: "issue";
  issue: CsslitIssue;
  loc: CsslitInputLocation;
  rootLoc?: CsslitInputLocation;
};

type CsslitStepDiagnostic = Error & {
  cause: unknown;
  [CSSLIT_DIAGNOSTIC]: CsslitStepDiagnosticInfo;
};

type CsslitIssueDiagnostic = Error & {
  cause: undefined;
  [CSSLIT_DIAGNOSTIC]: CsslitIssueDiagnosticInfo;
};

type CsslitDiagnostic = CsslitStepDiagnostic | CsslitIssueDiagnostic;

type CsslitCollectedDiagnosticStep = {
  subject: CsslitChainSubject;
  loc: CsslitInputLocation;
};

type CsslitCollectedIssueRootCause = {
  kind: "issue";
  issue: CsslitIssue;
  loc: CsslitInputLocation;
  rootLoc?: CsslitInputLocation;
};

type CsslitCollectedThrownRootCause = {
  kind: "thrown";
  rawCause: unknown;
  loc?: CsslitInputLocation;
  stack?: string;
  thrownValue: string;
};

export type CsslitCollectedEvalDiagnostic = {
  interpolation?: CsslitInputLocation;
  chain: CsslitCollectedDiagnosticStep[];
  rootCause: CsslitCollectedRootCause;
};

export type CsslitCollectedRootCause =
  | CsslitCollectedIssueRootCause
  | CsslitCollectedThrownRootCause;

export type CsslitEvalError = {
  diagnostic: CsslitCollectedEvalDiagnostic;
};

function isCsslitDiagnostic(error: unknown): error is CsslitDiagnostic {
  return (
    error instanceof Error &&
    typeof error === "object" &&
    error !== null &&
    CSSLIT_DIAGNOSTIC in error
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

function formatExpressionCode(code: CsslitExpressionCode): string {
  const articles: Record<CsslitExpressionCode, string> = {
    "delete-expression": "a delete expression",
    "call-expression": "a call expression",
    "private-field": "private field access",
    "array-expression": "an array expression",
    "arrow-function": "an arrow function",
    "assignment-expression": "an assignment expression",
    "await-expression": "an await expression",
    "class-expression": "a class expression",
    "function-expression": "a function expression",
    "import-expression": "an import expression",
    "new-expression": "a new expression",
    "object-expression": "an object expression",
    "sequence-expression": "a sequence expression",
    "tagged-template": "a tagged template",
    "update-expression": "an update expression",
    "yield-expression": "a yield expression",
    "private-in-expression": "a private in expression",
    jsx: "JSX",
    "unsupported-expression": "an unsupported expression",
  };
  return articles[code];
}

function getErrorName(error: unknown) {
  if (error instanceof Error) {
    return error.name;
  }

  return typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : undefined;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : String(error);
}

function getErrorStack(error: unknown) {
  if (error instanceof Error) {
    return error.stack;
  }

  return typeof error === "object" &&
    error !== null &&
    typeof (error as { stack?: unknown }).stack === "string"
    ? (error as { stack: string }).stack
    : undefined;
}

function getErrorLocation(error: unknown): CsslitInputLocation | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const rawLoc = (error as { loc?: unknown }).loc;
  if (typeof rawLoc !== "object" || rawLoc === null) {
    return undefined;
  }

  const line = (rawLoc as { line?: unknown }).line;
  const column = (rawLoc as { column?: unknown }).column;
  if (
    typeof line !== "number" ||
    !Number.isFinite(line) ||
    typeof column !== "number" ||
    !Number.isFinite(column)
  ) {
    return undefined;
  }

  const file = (rawLoc as { file?: unknown }).file;
  const endLine = (rawLoc as { endLine?: unknown }).endLine;
  const endColumn = (rawLoc as { endColumn?: unknown }).endColumn;
  return {
    file: typeof file === "string" ? file : undefined,
    line,
    column,
    endLine: typeof endLine === "number" && Number.isFinite(endLine) ? endLine : undefined,
    endColumn: typeof endColumn === "number" && Number.isFinite(endColumn) ? endColumn : undefined,
  };
}

export function trimModuleRunnerStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return stack;
  }
  const lines = stack.split("\n");
  const cutIndex = lines.findIndex((l) => l.includes("runInlinedModule"));
  return cutIndex !== -1 ? lines.slice(0, cutIndex).join("\n") : stack;
}

export function getThrownValueInfo(error: unknown) {
  let thrownValue: string;
  try {
    thrownValue = String(error);
  } catch {
    thrownValue = "<unstringifiable thrown value>";
  }

  return {
    stack: getErrorStack(error),
    thrownValue,
  };
}

function normalizeFile(file: string, options: CsslitErrorOptions) {
  return options.normalizeFile ? options.normalizeFile(file) : file;
}

function formatPredicateCode(code: CsslitDiagnosticPredicateCode) {
  switch (code) {
    case "runtime-parameter":
      return "is a runtime parameter.";
    case "function-binding":
      return "is a function binding.";
    case "class-binding":
      return "is a class binding.";
    case "catch-binding":
      return "is a catch binding.";
    case "reassigned":
      return "is reassigned.";
    case "destructured":
      return "comes from destructuring.";
    case "defaulted-binding-pattern":
      return "uses a defaulted binding pattern.";
    case "unknown-binding-pattern":
      return "uses an unknown binding pattern that csslit does not support.";
    case "loop-binding":
      return "comes from a loop binding.";
    case "no-initializer":
      return "has no initializer.";
    case "enum-declaration":
      return "is an enum declaration.";
    case "enum-member":
      return "is an enum member.";
    case "namespace-declaration":
      return "is a namespace/module declaration.";
    case "unknown-local-binding-kind":
      return "has an unknown local binding kind that csslit does not support.";
    case "not-value-binding":
      return "does not resolve to a value binding.";
    case "not-extracted-scope":
      return "is not available in the extracted scope.";
    case "circular-dependency":
      return "participates in a circular dependency.";
    case "used-before-initializer":
      return "is used before its initializer runs.";
    case "unsupported":
      return "is not supported here.";
  }
}

function decodeLocationToken(token: CsslitEvalLocationToken): CsslitInputLocation {
  const [line, column, endLine, endColumn] = token.split(":", 4).map(Number);
  invariant(
    [line, column, endLine, endColumn].every(Number.isFinite),
    `Malformed csslit location token: ${token}`,
  );
  return { line, column, endLine, endColumn };
}

function resolveLocation(
  loc: CsslitInputLocation | undefined,
  options: CsslitErrorOptions,
): CsslitEvalLocation | undefined {
  if (!loc) {
    return undefined;
  }

  const file = loc.file ?? options.fallbackFile;
  if (!file) {
    return undefined;
  }

  return {
    file: normalizeFile(file, options),
    line: loc.line,
    column: loc.column,
    endLine: loc.endLine ?? loc.line,
    endColumn: loc.endColumn ?? loc.column + 1,
  };
}

function buildCsslitDiagnosticData(
  error: unknown,
  interpolation?: CsslitInputLocation,
): CsslitEvalError {
  const diagnostics: CsslitDiagnostic[] = [];
  let current: unknown = error;

  while (isCsslitDiagnostic(current)) {
    diagnostics.push(current);
    current = current.cause;
  }

  const root = diagnostics[diagnostics.length - 1];
  const chain: CsslitCollectedDiagnosticStep[] = [];
  let thrownLoc = getErrorLocation(current);

  if (root) {
    const rootInfo = root[CSSLIT_DIAGNOSTIC];

    for (const entry of diagnostics) {
      const info = entry[CSSLIT_DIAGNOSTIC];
      switch (info.kind) {
        case "step":
          chain.push({
            subject: info.subject,
            loc: info.loc,
          });
          break;
        case "issue":
          break;
        default:
          assertNever(info, "Unsupported csslit diagnostic info");
      }
    }

    if (
      rootInfo.kind === "issue" &&
      rootInfo.issue.kind === "variable" &&
      rootInfo.rootLoc !== undefined &&
      rootInfo.loc !== rootInfo.rootLoc
    ) {
      chain.push({
        subject: { name: rootInfo.issue.name },
        loc: rootInfo.loc,
      });
    }

    if (rootInfo.kind === "issue") {
      return {
        diagnostic: {
          interpolation,
          chain,
          rootCause: {
            kind: "issue",
            issue: rootInfo.issue,
            loc: rootInfo.loc,
            rootLoc: rootInfo.rootLoc,
          },
        },
      };
    }

    thrownLoc = rootInfo.rootLoc ?? rootInfo.loc;
  }

  const thrown = getThrownValueInfo(current);
  return {
    diagnostic: {
      interpolation,
      chain,
      rootCause: {
        kind: "thrown",
        rawCause: current,
        loc: thrownLoc,
        stack: thrown.stack,
        thrownValue: thrown.thrownValue,
      },
    },
  };
}

export function createStepDiagnostic(
  subject: CsslitChainSubject,
  loc: CsslitEvalLocationToken,
  cause: unknown,
  rootLoc?: CsslitEvalLocationToken,
): CsslitStepDiagnostic;
export function createStepDiagnostic(
  subject: CsslitChainSubject,
  loc: CsslitEvalLocationToken,
  cause: unknown,
  rootLoc?: CsslitEvalLocationToken,
) {
  const error = new Error("CSS literal evaluation failed.") as CsslitStepDiagnostic;
  error.name = "CsslitEvaluationError";
  error.cause = cause;
  error[CSSLIT_DIAGNOSTIC] = {
    kind: "step",
    subject,
    loc: decodeLocationToken(loc),
    rootLoc: rootLoc === undefined || rootLoc === loc ? undefined : decodeLocationToken(rootLoc),
  };
  return error;
}

export function createIssueDiagnostic(
  issue: CsslitIssue,
  loc: CsslitEvalLocationToken,
  rootLoc?: CsslitEvalLocationToken,
) {
  const error = new Error("CSS literal evaluation failed.") as CsslitIssueDiagnostic;
  error.name = "CsslitEvaluationError";
  error.cause = undefined;
  error[CSSLIT_DIAGNOSTIC] = {
    kind: "issue",
    issue,
    loc: decodeLocationToken(loc),
    rootLoc: rootLoc === undefined || rootLoc === loc ? undefined : decodeLocationToken(rootLoc),
  };
  return error;
}

function formatHeadline(diagnostic: CsslitCollectedEvalDiagnostic) {
  const prefix = "CSS literal eval failed:";
  const chain = diagnostic.chain;
  const firstText = chain[0]?.subject.name;

  const root = diagnostic.rootCause;
  switch (root.kind) {
    case "thrown": {
      const rootText = chain[chain.length - 1]?.subject.name;
      const suffix = root.thrownValue ? `: ${root.thrownValue}.` : ".";
      if (firstText && rootText && firstText !== rootText) {
        return `${prefix} interpolation references ${firstText}, depending on ${rootText}, which threw during evaluation${suffix}`;
      }

      if (firstText) {
        return `${prefix} interpolation references ${firstText}, which threw during evaluation${suffix}`;
      }

      if (rootText) {
        return `${prefix} interpolation references ${rootText}, which threw during evaluation${suffix}`;
      }

      return `${prefix} interpolation threw during evaluation${suffix}`;
    }
    case "issue": {
      switch (root.issue.kind) {
        case "expression": {
          const rootText = chain[chain.length - 1]?.subject.name;
          if (firstText && rootText && firstText !== rootText) {
            return `${prefix} interpolation references ${firstText}, depending on ${rootText}, which depends on ${formatExpressionCode(root.issue.code)}.`;
          }

          if (firstText) {
            return `${prefix} interpolation references ${firstText}, which depends on ${formatExpressionCode(root.issue.code)}.`;
          }

          return `${prefix} interpolation failed.`;
        }
        case "variable": {
          const predicate = formatPredicateCode(root.issue.predicate);
          const rootText = root.issue.name;
          if (firstText && rootText && firstText !== rootText) {
            return `${prefix} interpolation references ${firstText}, depending on ${rootText}, which ${predicate}`;
          }

          if (firstText) {
            return `${prefix} interpolation references ${firstText}, which ${predicate}`;
          }

          return `${prefix} interpolation references ${rootText}, which ${predicate}`;
        }
        default:
          return assertNever(root.issue, "Unsupported csslit issue");
      }
    }
    default:
      return assertNever(root, "Unsupported csslit root cause");
  }
}

function parseStackLocation(
  line: string,
  options: CsslitErrorOptions,
): CsslitEvalLocation | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("at ")) {
    return undefined;
  }

  const match = trimmed.match(/\((.+):(\d+):(\d+)\)$/) ?? trimmed.match(/^at (.+):(\d+):(\d+)$/);
  if (!match) {
    return undefined;
  }

  const file = normalizeFile(match[1]!, options);
  if (options.ignoreStackFrameFile?.(file)) {
    return undefined;
  }

  const lineNumber = Number(match[2]);
  const columnNumber = Number(match[3]);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
    return undefined;
  }

  return {
    file,
    line: Math.max(0, lineNumber - 1),
    column: Math.max(0, columnNumber - 1),
    endLine: Math.max(0, lineNumber - 1),
    endColumn: Math.max(1, columnNumber),
  };
}

function sameStart(left?: CsslitEvalLocation | null, right?: CsslitEvalLocation | null) {
  return (
    !!left &&
    !!right &&
    left.file === right.file &&
    left.line === right.line &&
    left.column === right.column
  );
}

function sameRange(left?: CsslitEvalLocation, right?: CsslitEvalLocation) {
  return (
    !!left &&
    !!right &&
    sameStart(left, right) &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

function contains(outer?: CsslitEvalLocation, inner?: CsslitEvalLocation) {
  if (!outer || !inner || outer.file !== inner.file) {
    return false;
  }

  return (
    (inner.line > outer.line || (inner.line === outer.line && inner.column >= outer.column)) &&
    (inner.endLine < outer.endLine ||
      (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

function normalizeStack(stackText: string | undefined, options: CsslitErrorOptions) {
  return options.normalizeStackText ? options.normalizeStackText(stackText) : stackText;
}

function getStackLocations(stackText: string | undefined, options: CsslitErrorOptions) {
  const locations: CsslitEvalLocation[] = [];
  for (const line of normalizeStack(stackText, options)?.split("\n") ?? []) {
    const location = parseStackLocation(line, options);
    if (location) {
      locations.push(location);
    }
  }
  return locations;
}

function getMostSpecificStackLocation(
  stackText: string | undefined,
  target: CsslitEvalLocation | undefined,
  options: CsslitErrorOptions,
) {
  if (!target) {
    return null;
  }

  let best: CsslitEvalLocation | null = null;
  for (const location of getStackLocations(stackText, options)) {
    if (!contains(target, location) && !sameStart(location, target)) {
      continue;
    }
    if (
      !best ||
      location.line > best.line ||
      (location.line === best.line && location.column > best.column)
    ) {
      best = location;
    }
  }

  return best;
}

function trimStack(
  stackText: string | undefined,
  stop: CsslitEvalLocation | undefined,
  options: CsslitErrorOptions,
) {
  const lines = normalizeStack(stackText, options)?.split("\n");
  if (!lines?.length) {
    return stackText;
  }

  const stack = [lines[0] ?? "Error"];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) {
      continue;
    }
    if (trimmed.includes("virtual:csslit-eval-runtime")) {
      if (/^at (?:async )?(?:.+\.)?capture \(/.test(trimmed)) {
        break;
      }
      continue;
    }

    const location = parseStackLocation(line, options);
    if (!location) {
      continue;
    }

    stack.push(line);
    if (sameStart(location, stop)) {
      break;
    }
  }

  return stack.join("\n");
}

function formatLink(loc: CsslitEvalLocation) {
  return `${loc.file}:${loc.line + 1}:${loc.column + 1}`;
}

function formatSection(
  title: string,
  loc: CsslitEvalLocation,
  label: string | undefined,
  options: CsslitErrorOptions,
  pointOnly = false,
) {
  const lines = [`${title}:`];
  lines.push(`  at ${formatLink(loc)}`);

  const source = options.readSource?.(loc.file);
  if (!source) {
    return lines.join("\n");
  }

  const sourceLines = source.replace(/\r\n?/g, "\n").split("\n");
  const lastLine = Math.max(loc.line, loc.endLine);
  const startLine = Math.max(1, loc.line);
  const endLine = Math.min(sourceLines.length, lastLine + 2);
  const width = String(endLine).length;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const sourceLine = sourceLines[lineNumber - 1] ?? "";
    lines.push(`  ${String(lineNumber).padStart(width)} | ${sourceLine}`);
    if (lineNumber < loc.line + 1 || lineNumber > lastLine + 1) {
      continue;
    }

    const start = lineNumber === loc.line + 1 ? loc.column : 0;
    const trailingOperator = sourceLine.slice(loc.endColumn, loc.endColumn + 2);
    const end = pointOnly
      ? start + 1
      : lineNumber === lastLine + 1
        ? Math.max(
            start + 1,
            Math.min(
              sourceLine.length,
              loc.endColumn + (trailingOperator === "++" || trailingOperator === "--" ? 2 : 0),
            ),
          )
        : sourceLine.length;
    lines.push(
      `  ${" ".repeat(width)} | ${" ".repeat(start)}${"^".repeat(Math.max(1, end - start))}${lineNumber === loc.line + 1 && label ? ` ${label}` : ""}`,
    );
  }

  return lines.join("\n");
}

function formatFrame(diagnostic: CsslitCollectedEvalDiagnostic, options: CsslitErrorOptions) {
  const chain = diagnostic.chain;
  const interpolation = resolveLocation(chain[0]?.loc ?? diagnostic.interpolation, options);
  const displayedChain = chain[0] ? chain.slice(1) : chain;
  const root = diagnostic.rootCause;

  switch (root.kind) {
    case "thrown": {
      const sections: string[] = [];
      const rootSubject = chain[chain.length - 1]?.subject.name;
      const rootLabel = root.thrownValue
        ? root.stack
          ? root.thrownValue
          : rootSubject
            ? `${rootSubject} threw ${root.thrownValue}`
            : `threw ${root.thrownValue}`
        : rootSubject
          ? `${rootSubject} threw during evaluation.`
          : "threw during evaluation.";

      const rootLoc = resolveLocation(root.loc, options);
      const rootBoundary = rootLoc
        ? (getMostSpecificStackLocation(root.stack, rootLoc, options) ?? rootLoc)
        : (getStackLocations(root.stack, options)[0] ?? undefined);
      const directThrownBoundary =
        displayedChain.length === 0 && interpolation
          ? (getMostSpecificStackLocation(root.stack, interpolation, options) ?? undefined)
          : undefined;
      const inlineRoot = displayedChain.length === 0 && directThrownBoundary !== undefined;
      const thrownBoundary =
        directThrownBoundary ??
        (inlineRoot && interpolation
          ? getMostSpecificStackLocation(root.stack, interpolation, options)
          : null) ??
        rootBoundary ??
        (() => {
          const locations = getStackLocations(root.stack, options);
          return locations[locations.length - 1];
        })() ??
        undefined;
      const inlineBoundary = thrownBoundary ?? interpolation;
      const interpolationLoc =
        inlineRoot && inlineBoundary
          ? {
              file: inlineBoundary.file,
              line: inlineBoundary.line,
              column: inlineBoundary.column,
              endLine: inlineBoundary.line,
              endColumn: inlineBoundary.column + 1,
            }
          : interpolation;

      if (interpolationLoc) {
        sections.push(
          formatSection(
            "Interpolation",
            interpolationLoc,
            inlineRoot
              ? (rootLabel ?? (chain[0] ? `references ${chain[0].subject.name}` : undefined))
              : chain[0]
                ? `references ${chain[0].subject.name}`
                : undefined,
            options,
            inlineRoot && chain.length > 0,
          ),
        );
      }

      if (displayedChain.length) {
        const width = Math.max(...displayedChain.map((step) => step.subject.name.length), 0);
        sections.push(
          [
            "Dependency chain:",
            ...displayedChain.map((step) => {
              const subject = step.subject.name.padEnd(width, " ");
              const loc = resolveLocation(step.loc, options);
              return loc ? `  ${subject}  at ${formatLink(loc)}` : `  ${subject}`;
            }),
          ].join("\n"),
        );
      }

      if (!inlineRoot) {
        const boundary = thrownBoundary ?? rootBoundary;
        sections.push(
          boundary
            ? formatSection("Root cause", boundary, rootLabel, options, true)
            : ["Root cause:", rootLabel ? `  ${rootLabel}` : ""].filter(Boolean).join("\n"),
        );
      }

      const stack = trimStack(root.stack, thrownBoundary, options);
      if (stack) {
        sections.push(["Stack trace:", ...stack.split("\n").map((line) => `  ${line}`)].join("\n"));
      }

      return sections.length ? sections.join("\n\n") : undefined;
    }
    case "issue": {
      const sections: string[] = [];
      const rootBoundary =
        resolveLocation(root.rootLoc, options) ?? resolveLocation(root.loc, options);
      const rootLabel = (() => {
        switch (root.issue.kind) {
          case "variable":
            return `${root.issue.name} ${formatPredicateCode(root.issue.predicate)}`;
          case "expression": {
            const owner = chain[chain.length - 1]?.subject;
            return owner
              ? `${owner.name} depends on ${formatExpressionCode(root.issue.code)}.`
              : formatExpressionCode(root.issue.code);
          }
          default:
            return assertNever(root.issue, "Unsupported csslit issue");
        }
      })();
      const inlineRoot =
        displayedChain.length === 0 && (!rootBoundary || sameRange(rootBoundary, interpolation));

      if (interpolation) {
        sections.push(
          formatSection(
            "Interpolation",
            interpolation,
            inlineRoot
              ? (rootLabel ?? (chain[0] ? `references ${chain[0].subject.name}` : undefined))
              : chain[0]
                ? `references ${chain[0].subject.name}`
                : undefined,
            options,
          ),
        );
      }

      if (displayedChain.length) {
        const width = Math.max(...displayedChain.map((step) => step.subject.name.length), 0);
        sections.push(
          [
            "Dependency chain:",
            ...displayedChain.map((step) => {
              const subject = step.subject.name.padEnd(width, " ");
              const loc = resolveLocation(step.loc, options);
              return loc ? `  ${subject}  at ${formatLink(loc)}` : `  ${subject}`;
            }),
          ].join("\n"),
        );
      }

      if (!inlineRoot) {
        sections.push(
          rootBoundary
            ? formatSection("Root cause", rootBoundary, rootLabel, options)
            : ["Root cause:", rootLabel ? `  ${rootLabel}` : ""].filter(Boolean).join("\n"),
        );
      }

      return sections.length ? sections.join("\n\n") : undefined;
    }
    default:
      return assertNever(root, "Unsupported csslit root cause");
  }
}

export function buildCsslitError(
  error: unknown,
  options: CsslitErrorOptions = {},
): CsslitBuiltError {
  const collectedDiagnostic =
    typeof error === "object" && error !== null
      ? (error as { diagnostic?: CsslitCollectedEvalDiagnostic }).diagnostic
      : undefined;
  if (!collectedDiagnostic) {
    const loc = resolveLocation(getErrorLocation(error), options);
    return {
      kind: "generic",
      loc: loc
        ? {
            file: loc.file,
            line: loc.line + 1,
            column: loc.column + 1,
          }
        : undefined,
      message: getErrorMessage(error),
      name: getErrorName(error),
      stack: getErrorStack(error),
    };
  }

  const stack =
    collectedDiagnostic.rootCause.kind === "thrown"
      ? collectedDiagnostic.rootCause.stack
      : undefined;
  const loc =
    resolveLocation(collectedDiagnostic.chain[0]?.loc, options) ??
    resolveLocation(collectedDiagnostic.interpolation, options) ??
    resolveLocation(collectedDiagnostic.rootCause.loc, options) ??
    getStackLocations(stack, options)[0] ??
    undefined;

  return {
    frame: formatFrame(collectedDiagnostic, options),
    kind: "csslit",
    loc: loc
      ? {
          file: loc.file,
          line: loc.line + 1,
          column: loc.column + 1,
        }
      : undefined,
    message: formatHeadline(collectedDiagnostic),
    name:
      collectedDiagnostic.rootCause.kind === "thrown"
        ? getErrorName(collectedDiagnostic.rootCause.rawCause)
        : undefined,
    stack: trimStack(
      stack,
      resolveLocation(collectedDiagnostic.rootCause.loc, options) ?? loc,
      options,
    ),
  };
}

export function toCsslitEvalError(error: unknown): CsslitEvalError {
  return buildCsslitDiagnosticData(error);
}

export function throwEvalError(
  issue: CsslitIssue,
  loc: CsslitEvalLocationToken,
  rootLoc?: CsslitEvalLocationToken,
): never {
  throw createIssueDiagnostic(issue, loc, rootLoc);
}

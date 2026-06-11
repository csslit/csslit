export interface Location {
  row: number;
  col: number;
}

export interface Span {
  start: Location;
  end: Location;
}

interface FileLocation {
  file: string;
  location: Location;
}

interface BuiltErrorLocation {
  file: string;
  line: number;
  column: number;
}

interface StackOptions {
  normalizeFile: (file: string) => string;
  normalizeStackText: (stackText: string) => string;
  stopStackTraceAtFile: (file: string) => boolean;
}

interface BuiltError {
  frame: string;
  loc: BuiltErrorLocation;
  message: string;
}

interface BuiltEvaluationError {
  loc?: BuiltErrorLocation;
  message: string;
  stack?: string;
}

interface ErrorOptions extends StackOptions {
  readSource: (file: string) => string;
  sourceFile: string;
}

export type DiagnosticPredicateCode =
  | "runtime-parameter"
  | "function-binding"
  | "class-binding"
  | "catch-binding"
  | "reassigned"
  | "destructured"
  | "defaulted-binding-pattern"
  | "unknown-binding-pattern"
  | "loop-binding"
  | "no-initializer"
  | "enum-declaration"
  | "enum-member"
  | "namespace-declaration"
  | "unknown-local-binding-kind"
  | "not-value-binding"
  | "not-extracted-scope"
  | "circular-dependency"
  | "used-before-initializer"
  | "unsupported";

export type ExpressionCode =
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

export interface Dependency {
  name: string;
  reference: Span;
  source: Span;
}

interface VariableIssueRootCause {
  kind: "variable";
  name: string;
  predicate: DiagnosticPredicateCode;
  reference: Span;
  source: Span;
}

interface ExpressionIssueRootCause {
  kind: "expression";
  code: ExpressionCode;
  source: Span;
}

interface ThrownRootCause {
  kind: "thrown";
  source: Span;
  stack?: string;
  text: string;
}

export interface EvalDiagnostic {
  dependencies: Dependency[];
  primaryName?: string;
  primaryReference: Span;
  rootCause: RootCause;
}

type RootCause = VariableIssueRootCause | ExpressionIssueRootCause | ThrownRootCause;

function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

const expressionStrings: Record<ExpressionCode, string> = {
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

export function trimModuleRunnerStack(stack: string): string {
  const lines = stack.split("\n");
  const cutIndex = lines.findIndex((l) => l.includes("runInlinedModule"));
  return cutIndex !== -1 ? lines.slice(0, cutIndex).join("\n") : stack;
}

const predicateStrings: Record<DiagnosticPredicateCode, string> = {
  "runtime-parameter": "is a runtime parameter.",
  "function-binding": "is a function binding.",
  "class-binding": "is a class binding.",
  "catch-binding": "is a catch binding.",
  reassigned: "is reassigned.",
  destructured: "comes from destructuring.",
  "defaulted-binding-pattern": "uses a defaulted binding pattern.",
  "unknown-binding-pattern": "uses an unknown binding pattern that csslit does not support.",
  "loop-binding": "comes from a loop binding.",
  "no-initializer": "has no initializer.",
  "enum-declaration": "is an enum declaration.",
  "enum-member": "is an enum member.",
  "namespace-declaration": "is a namespace/module declaration.",
  "unknown-local-binding-kind": "has an unknown local binding kind that csslit does not support.",
  "not-value-binding": "does not resolve to a value binding.",
  "not-extracted-scope": "is not available in the extracted scope.",
  "circular-dependency": "participates in a circular dependency.",
  "used-before-initializer": "is used before its initializer runs.",
  unsupported: "is not supported here.",
};

function formatHeadline(diagnostic: EvalDiagnostic) {
  const prefix = "CSS literal eval failed:";
  const primaryName = diagnostic.primaryName;
  const deps = diagnostic.dependencies;

  const rootCause = diagnostic.rootCause;
  switch (rootCause.kind) {
    case "thrown": {
      const suffix = rootCause.text ? `: ${rootCause.text}.` : ".";

      if (primaryName === undefined) {
        return `${prefix} interpolation threw during evaluation${suffix}`;
      }

      if (deps.length > 0) {
        const root = deps.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which threw during evaluation${suffix}`;
      }

      return `${prefix} interpolation references ${primaryName}, which threw during evaluation${suffix}`;
    }
    case "expression": {
      const expression = expressionStrings[rootCause.code];
      if (primaryName === undefined) {
        return `${prefix} interpolation contains ${expression}.`;
      }

      if (deps.length > 0) {
        const root = deps.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which depends on ${expression}.`;
      }

      return `${prefix} interpolation references ${primaryName}, which depends on ${expression}.`;
    }
    case "variable": {
      const predicate = predicateStrings[rootCause.predicate];
      if (primaryName === undefined) {
        return `${prefix} interpolation references ${rootCause.name}, which ${predicate}`;
      }

      if (deps.length > 0) {
        const root = deps.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which ${predicate}`;
      }

      return `${prefix} interpolation references ${primaryName}, which ${predicate}`;
    }
    default:
      return assertNever(rootCause, "Unsupported csslit root cause");
  }
}

function parseStackLocation(line: string, options: StackOptions): FileLocation | undefined {
  const match = /^ *at (?:(?:.+) \((.+):([0-9]+):([0-9]+)\)|(.+):([0-9]+):([0-9]+))$/.exec(line);
  if (!match) {
    return undefined;
  }

  const file = options.normalizeFile(match[1] ?? match[4]!);
  const lineNumber = Number(match[2] ?? match[5]);
  const columnNumber = Number(match[3] ?? match[6]);

  return {
    file,
    location: {
      row: lineNumber - 1,
      col: columnNumber - 1,
    },
  };
}

function locationEq(left: Location, right: Location) {
  return left.row === right.row && left.col === right.col;
}

function spanEq(left: Span, right: Span) {
  return locationEq(left.start, right.start) && locationEq(left.end, right.end);
}

function spanContainsLocation(span: Span, location: Location) {
  const boundaryStart = span.start;
  const boundaryEnd = span.end;
  return (
    (location.row > boundaryStart.row ||
      (location.row === boundaryStart.row && location.col >= boundaryStart.col)) &&
    (location.row < boundaryEnd.row ||
      (location.row === boundaryEnd.row && location.col <= boundaryEnd.col))
  );
}

function analyzeThrownStack(
  stack: string,
  file: string,
  span: Span,
  options: ErrorOptions,
): { source: FileLocation; stack: string } {
  const stackLines = stack.split("\n");
  let trimmedStack = stackLines[0]!;
  let source: FileLocation | undefined;

  for (let index = 1; index < stackLines.length; index += 1) {
    const line = stackLines[index]!;

    const location = parseStackLocation(line, options);

    if (!location) {
      continue;
    }

    if (options.stopStackTraceAtFile(location.file)) {
      break;
    }

    trimmedStack += `\n${line}`;

    if (location.file === file && spanContainsLocation(span, location.location)) {
      source = location;
      break;
    }
  }

  return {
    source: source ?? {
      file,
      location: span.start,
    },
    stack: trimmedStack,
  };
}

function firstStackLocation(stack: string, options: StackOptions) {
  for (const line of stack.split("\n")) {
    const location = parseStackLocation(line, options);
    if (location) {
      return location;
    }
  }

  return undefined;
}

function formatLink(file: string, location: Location) {
  return `${file}:${location.row + 1}:${location.col + 1}`;
}

function formatSection(
  title: string,
  file: string,
  span: Span,
  label: string | undefined,
  options: ErrorOptions,
) {
  let frame = `${title}:\n  at ${formatLink(file, span.start)}`;

  const sourceText = options.readSource(file);
  const sourceLines = sourceText.split(/\r\n?|\n/);

  const startLine = Math.max(1, span.start.row);
  const endLine = Math.min(sourceLines.length, span.end.row + 2);
  const width = String(endLine).length;
  const pointOnly = locationEq(span.start, span.end);

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const sourceLine = sourceLines[lineNumber - 1] ?? "";

    frame += `\n  ${String(lineNumber).padStart(width)} | ${sourceLine}`;

    if (lineNumber < span.start.row + 1 || lineNumber > span.end.row + 1) {
      continue;
    }

    const start = lineNumber === span.start.row + 1 ? span.start.col : 0;

    const end = pointOnly
      ? start
      : lineNumber === span.end.row + 1
        ? Math.min(sourceLine.length, span.end.col)
        : sourceLine.length;

    const caretWidth = end === start ? 1 : end - start;

    frame += `\n  ${" ".repeat(width)} | ${" ".repeat(start)}${"^".repeat(caretWidth)}`;

    if (lineNumber === span.start.row + 1 && label) {
      frame += ` ${label}`;
    }
  }

  return frame;
}

function formatFrame(diagnostic: EvalDiagnostic, options: ErrorOptions) {
  const primaryName = diagnostic.primaryName;
  const dependencies = diagnostic.dependencies;
  const hasDependencyChain = dependencies.length > 0;
  const sourceFile = options.sourceFile;
  const interpolation = diagnostic.primaryReference;
  const root = diagnostic.rootCause;

  switch (root.kind) {
    case "thrown": {
      const stack = root.stack ? options.normalizeStackText(root.stack) : undefined;

      let rootLabel: string;
      if (stack) {
        rootLabel = root.text;
      } else if (hasDependencyChain) {
        rootLabel = `${dependencies.at(-1)!.name} threw ${root.text}`;
      } else if (primaryName !== undefined) {
        rootLabel = `${primaryName} threw ${root.text}`;
      } else {
        rootLabel = `threw ${root.text}`;
      }

      let thrownSource: FileLocation;
      let trimmedStack: string | undefined;
      if (stack) {
        const analyzedStack = analyzeThrownStack(stack, sourceFile, root.source, options);
        thrownSource = analyzedStack.source;
        trimmedStack = analyzedStack.stack;
      } else {
        thrownSource = {
          file: sourceFile,
          location: root.source.start,
        };
      }

      const inlineRoot =
        !hasDependencyChain &&
        thrownSource.file === sourceFile &&
        spanContainsLocation(interpolation, thrownSource.location);

      let interpolationSectionSpan = inlineRoot
        ? { start: thrownSource.location, end: thrownSource.location }
        : interpolation;

      let interpolationSectionFile = inlineRoot ? thrownSource.file : sourceFile;

      let label: string | undefined;
      if (inlineRoot) {
        label = rootLabel;
      } else if (primaryName !== undefined) {
        label = `references ${primaryName}`;
      } else {
        label = undefined;
      }

      let frame = formatSection(
        "Interpolation",
        interpolationSectionFile,
        interpolationSectionSpan,
        label,
        options,
      );

      if (hasDependencyChain) {
        const width = Math.max(...dependencies.map((dependency) => dependency.name.length));
        frame += "\n\nDependency chain:";
        for (const dependency of dependencies) {
          const subject = dependency.name.padEnd(width, " ");
          frame += `\n  ${subject}  at ${formatLink(sourceFile, dependency.reference.start)}`;
        }
      }

      if (!inlineRoot) {
        frame +=
          "\n\n" +
          formatSection(
            "Root cause",
            thrownSource.file,
            { start: thrownSource.location, end: thrownSource.location },
            rootLabel,
            options,
          );
      }

      if (trimmedStack) {
        frame += "\n\nStack trace:";
        for (const line of trimmedStack.split("\n")) {
          frame += `\n  ${line}`;
        }
      }

      return frame;
    }
    case "variable": {
      let label: string | undefined;
      label = `references ${primaryName!}`;

      let frame = formatSection("Interpolation", sourceFile, interpolation, label, options);

      if (hasDependencyChain) {
        const width = Math.max(...dependencies.map((dependency) => dependency.name.length));
        frame += "\n\nDependency chain:";
        for (const dependency of dependencies) {
          const subject = dependency.name.padEnd(width, " ");
          frame += `\n  ${subject}  at ${formatLink(sourceFile, dependency.reference.start)}`;
        }
      }

      frame +=
        "\n\n" +
        formatSection(
          "Root cause",
          sourceFile,
          root.source,
          `${root.name} ${predicateStrings[root.predicate]}`,
          options,
        );

      return frame;
    }
    case "expression": {
      const rootBoundary = root.source;
      const rootName = hasDependencyChain ? dependencies.at(-1)!.name : primaryName;
      const rootLabel =
        rootName !== undefined
          ? `${rootName} depends on ${expressionStrings[root.code]}.`
          : `contains ${expressionStrings[root.code]}`;

      const inlineRoot = primaryName === undefined && !hasDependencyChain;

      let label: string | undefined;
      if (inlineRoot) {
        label = rootLabel;
      } else if (primaryName !== undefined) {
        label = `references ${primaryName}`;
      }

      let frame = formatSection("Interpolation", sourceFile, interpolation, label, options);

      if (hasDependencyChain) {
        const width = Math.max(...dependencies.map((dependency) => dependency.name.length));
        frame += "\n\nDependency chain:";
        for (const dependency of dependencies) {
          const subject = dependency.name.padEnd(width, " ");
          frame += `\n  ${subject}  at ${formatLink(sourceFile, dependency.reference.start)}`;
        }
      }

      if (!inlineRoot) {
        frame += "\n\n" + formatSection("Root cause", sourceFile, rootBoundary, rootLabel, options);
      }

      return frame;
    }
    default:
      return assertNever(root, "Unsupported csslit root cause");
  }
}

export function buildCsslitError(diagnostic: EvalDiagnostic, options: ErrorOptions): BuiltError {
  const loc = diagnostic.primaryReference;

  return {
    frame: formatFrame(diagnostic, options),
    loc: {
      file: options.sourceFile,
      line: loc.start.row + 1,
      column: loc.start.col + 1,
    },
    message: formatHeadline(diagnostic),
  };
}

export function buildCsslitEvaluationError(
  error: unknown,
  sourceFile: string,
  options: StackOptions,
): BuiltEvaluationError {
  let text: string;
  try {
    text = String(error);
  } catch {
    text = "<unstringifiable thrown value>";
  }

  const stack =
    error instanceof Error && error.stack ? options.normalizeStackText(error.stack) : undefined;

  const location = stack ? firstStackLocation(stack, options) : undefined;

  return {
    loc: location
      ? {
          file: location.file,
          line: location.location.row + 1,
          column: location.location.col + 1,
        }
      : undefined,
    message: `CSS literal evaluation failed while evaluating ${sourceFile}.\n${text}`,
    stack,
  };
}

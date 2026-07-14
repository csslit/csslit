export interface Location {
  row: number;
  col: number;
}

export interface Span {
  start: Location;
  end: Location;
}

export interface FileLocation {
  file: string;
  location: Location;
}

interface StackLine {
  line: string;
  location?: FileLocation;
}

interface BuiltErrorLocation {
  file: string;
  line: number;
  column: number;
}

interface StackOptions {
  normalizeStackLine: (line: string) => StackLine | undefined;
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
  interpolation: Span;
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

const predicateStrings: Record<DiagnosticPredicateCode, string> = {
  "runtime-parameter": "is a runtime parameter.",
  "function-binding": "is a function binding.",
  "class-binding": "is a class binding.",
  "catch-binding": "is a catch binding.",
  reassigned: "is reassigned.",
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
  const dependencies = diagnostic.dependencies;
  const primary = dependencies[0];
  const primaryName = primary?.name;
  const hasDependencyChain = dependencies.length > 1;

  const rootCause = diagnostic.rootCause;
  switch (rootCause.kind) {
    case "thrown": {
      const suffix = rootCause.text ? `: ${rootCause.text}.` : ".";

      if (primaryName === undefined) {
        return `${prefix} interpolation threw during evaluation${suffix}`;
      }

      if (hasDependencyChain) {
        const root = dependencies.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which threw during evaluation${suffix}`;
      }

      return `${prefix} interpolation references ${primaryName}, which threw during evaluation${suffix}`;
    }
    case "expression": {
      const expression = expressionStrings[rootCause.code];
      if (primaryName === undefined) {
        return `${prefix} interpolation contains ${expression}.`;
      }

      if (hasDependencyChain) {
        const root = dependencies.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which depends on ${expression}.`;
      }

      return `${prefix} interpolation references ${primaryName}, which depends on ${expression}.`;
    }
    case "variable": {
      const predicate = predicateStrings[rootCause.predicate];
      if (primaryName === undefined) {
        return `${prefix} interpolation references ${rootCause.name}, which ${predicate}`;
      }

      if (hasDependencyChain) {
        const root = dependencies.at(-1)!;
        return `${prefix} interpolation references ${primaryName}, depending on ${root.name}, which ${predicate}`;
      }

      return `${prefix} interpolation references ${primaryName}, which ${predicate}`;
    }
    default:
      return assertNever(rootCause, "Unsupported csslit root cause");
  }
}

function locationEq(left: Location, right: Location) {
  return left.row === right.row && left.col === right.col;
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
): { location: Location; stack: string } {
  let location: Location | undefined;

  const lines = stack.split("\n");
  let trimmedStack = lines.shift() ?? "";

  for (const line of lines) {
    const stackLine = options.normalizeStackLine(line);
    if (!stackLine) {
      break;
    }

    trimmedStack += `\n${stackLine.line}`;

    const fileLocation = stackLine.location;
    if (fileLocation?.file === file && spanContainsLocation(span, fileLocation.location)) {
      location = fileLocation.location;
      break;
    }
  }

  return {
    location: location ?? span.start,
    stack: trimmedStack,
  };
}

function analyzeStack(stack: string, options: StackOptions) {
  let trimmedStack = "";
  let location: FileLocation | undefined;

  for (const line of stack.split("\n")) {
    const stackLine = options.normalizeStackLine(line);
    if (!stackLine) {
      break;
    }

    trimmedStack += trimmedStack ? `\n${stackLine.line}` : stackLine.line;
    location ??= stackLine.location;
  }

  return {
    location,
    stack: trimmedStack,
  };
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
  const dependencies = diagnostic.dependencies;
  const rootCause = diagnostic.rootCause;

  switch (rootCause.kind) {
    case "thrown": {
      let thrownLocation = rootCause.source.start;
      let trimmedStack: string | undefined;
      if (rootCause.stack) {
        const analyzedStack = analyzeThrownStack(
          rootCause.stack,
          options.sourceFile,
          rootCause.source,
          options,
        );
        thrownLocation = analyzedStack.location;
        trimmedStack = analyzedStack.stack;
      }

      let frame;
      if (dependencies.length === 0) {
        frame = formatSection(
          "Interpolation",
          options.sourceFile,
          { start: thrownLocation, end: thrownLocation },
          rootCause.text,
          options,
        );
      } else {
        let deps = [...dependencies];
        const primary = deps.shift()!;
        frame = formatSection(
          "Interpolation",
          options.sourceFile,
          primary.reference,
          `references ${primary.name}`,
          options,
        );

        if (deps.length !== 0) {
          let width = 0;
          for (const d of deps) if (d.name.length > width) width = d.name.length;
          frame += "\n\nDependency chain:";
          for (const dependency of deps) {
            frame += `\n  ${dependency.name.padEnd(width, " ")}  at ${formatLink(options.sourceFile, dependency.reference.start)}`;
          }
        }

        frame +=
          "\n\n" +
          formatSection(
            "Root cause",
            options.sourceFile,
            { start: thrownLocation, end: thrownLocation },
            rootCause.text,
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
      if (dependencies.length === 0)
        throw new Error("Expected variable issue to have at least one dependency");

      let deps = [...dependencies];
      const primary = deps.shift()!;

      let frame = formatSection(
        "Interpolation",
        options.sourceFile,
        primary.reference,
        `references ${primary.name}`,
        options,
      );

      if (deps.length !== 0) {
        let width = 0;
        for (const d of deps) if (d.name.length > width) width = d.name.length;

        frame += "\n\nDependency chain:";
        for (const dependency of deps) {
          frame += `\n  ${dependency.name.padEnd(width, " ")}  at ${formatLink(options.sourceFile, dependency.reference.start)}`;
        }
      }

      frame +=
        "\n\n" +
        formatSection(
          "Root cause",
          options.sourceFile,
          rootCause.source,
          `${rootCause.name} ${predicateStrings[rootCause.predicate]}`,
          options,
        );

      return frame;
    }
    case "expression": {
      if (dependencies.length === 0) {
        return formatSection(
          "Interpolation",
          options.sourceFile,
          diagnostic.interpolation,
          `contains ${expressionStrings[rootCause.code]}`,
          options,
        );
      } else {
        let deps = [...dependencies];
        const root = deps.at(-1)!;
        const primary = deps.shift()!;
        let frame = formatSection(
          "Interpolation",
          options.sourceFile,
          primary.reference,
          `references ${primary.name}`,
          options,
        );

        if (deps.length !== 0) {
          let width = 0;
          for (const d of deps) if (d.name.length > width) width = d.name.length;

          frame += "\n\nDependency chain:";
          for (const dependency of deps) {
            frame += `\n  ${dependency.name.padEnd(width, " ")}  at ${formatLink(options.sourceFile, dependency.reference.start)}`;
          }
        }

        frame +=
          "\n\n" +
          formatSection(
            "Root cause",
            options.sourceFile,
            rootCause.source,
            `${root.name} depends on ${expressionStrings[rootCause.code]}.`,
            options,
          );

        return frame;
      }
    }
    default:
      return assertNever(rootCause, "Unsupported csslit root cause");
  }
}

export function buildCsslitError(diagnostic: EvalDiagnostic, options: ErrorOptions): BuiltError {
  const loc = diagnostic.dependencies[0]?.reference ?? diagnostic.interpolation;

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
    error instanceof Error && error.stack ? analyzeStack(error.stack, options) : undefined;
  const location = stack?.location;

  return {
    loc: location
      ? {
          file: location.file,
          line: location.location.row + 1,
          column: location.location.col + 1,
        }
      : undefined,
    message: `CSS literal evaluation failed while evaluating ${sourceFile}.\n${text}`,
    stack: stack?.stack,
  };
}

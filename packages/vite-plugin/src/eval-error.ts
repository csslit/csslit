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
  | "class-binding"
  | "catch-binding"
  | "reassigned"
  | "loop-binding"
  | "no-initializer"
  | "enum-declaration"
  | "namespace-declaration"
  | "unknown-local-binding-kind"
  | "not-value-binding"
  | "used-before-initializer";

export type ExpressionCode =
  | "delete-expression"
  | "call-expression"
  | "invalid-comptime-call"
  | "private-field"
  | "array-expression"
  | "binding-mutation-outside-closure"
  | "captured-binding-mutation"
  | "property-mutation"
  | "await-expression"
  | "class-expression"
  | "import-expression"
  | "new-expression"
  | "object-expression"
  | "sequence-expression"
  | "tagged-template"
  | "yield-expression"
  | "private-in-expression"
  | "jsx"
  | "super-expression"
  | "unsupported-expression";

type BindingMutationExpressionCode =
  | "binding-mutation-outside-closure"
  | "captured-binding-mutation";

export type ExpressionIssue =
  | {
      code: Exclude<ExpressionCode, BindingMutationExpressionCode>;
    }
  | {
      code: BindingMutationExpressionCode;
      binding: string;
    };

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
  issue: ExpressionIssue;
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

interface DiagnosticAdvice {
  note?: string;
  help?: string;
}

interface DiagnosticDescription extends DiagnosticAdvice {
  headline: string;
  label: string;
}

interface VariableDiagnosticDescription extends DiagnosticAdvice {
  headline: (name: string) => string;
  label: (name: string) => string;
}

const stableValueNote = "stable CSS values contain no state that changes after they are produced";

const expressionDescriptions: Record<ExpressionCode, DiagnosticDescription> = {
  "delete-expression": {
    headline: "cannot delete an object property during CSS evaluation",
    label: "deleting a property modifies the object",
    note: "objects used during CSS evaluation are assumed to remain unchanged",
  },
  "call-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "the stability of a function's return value cannot be inferred",
    note: stableValueNote,
    help: "wrap this call in `comptime(...)` to assert that its return value is stable",
  },
  "invalid-comptime-call": {
    headline: "invalid `comptime` assertion",
    label: "`comptime` expects exactly one non-spread argument",
  },
  "private-field": {
    headline: "private fields are unavailable during CSS evaluation",
    label: "private names cannot be moved outside their class",
  },
  "array-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "new arrays can contain state that changes later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting array is stable",
  },
  "binding-mutation-outside-closure": {
    headline: "cannot modify binding during CSS evaluation",
    label: "only bindings declared inside a closure can be modified",
    note: "stateful calculations must be contained in closure-local bindings",
  },
  "captured-binding-mutation": {
    headline: "cannot modify captured binding during CSS evaluation",
    label: "this binding is captured by the closure",
    note: "closures may read captured bindings, but may only modify their own locals",
  },
  "property-mutation": {
    headline: "cannot modify an object property during CSS evaluation",
    label: "object properties cannot be modified during CSS evaluation",
    note: "objects used during CSS evaluation are assumed to remain unchanged",
    help: "construct the object in a single expression, using immutable patterns such as spreads or `Object.fromEntries`",
  },
  "await-expression": {
    headline: "`await` is not supported in CSS interpolations",
    label: "direct compile-time `await` is not supported",
    note: "CSS evaluation is synchronous; a promise cannot resolve before the CSS is produced",
  },
  "class-expression": {
    headline: "classes are not supported during CSS evaluation",
    label: "class evaluation is not supported",
    help: "declare the class in a separate module and import it",
  },
  "import-expression": {
    headline: "dynamic imports are not supported during CSS evaluation",
    label: "dynamic import produces an asynchronous value",
    help: "use a static import instead",
  },
  "new-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "constructed instances can contain state that changes later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting instance is stable",
  },
  "object-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "new objects can contain state that changes later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting object is stable",
  },
  "sequence-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "the stability of a sequence expression's result cannot be inferred",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that its result is stable",
  },
  "tagged-template": {
    headline: "expression is not known to produce a stable CSS value",
    label: "the stability of a tag function's return value cannot be inferred",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the tag's return value is stable",
  },
  "yield-expression": {
    headline: "`yield` cannot provide a value during compile-time CSS evaluation",
    label: "a yielded value only exists when its generator is iterated",
  },
  "private-in-expression": {
    headline: "private names are unavailable during CSS evaluation",
    label: "private names cannot be moved outside their class",
  },
  jsx: {
    headline: "JSX is not supported during CSS evaluation",
    label: "JSX cannot be evaluated as a CSS value",
  },
  "super-expression": {
    headline: "`super` is not supported during CSS evaluation",
    label: "`super` cannot be evaluated by csslit",
  },
  "unsupported-expression": {
    headline: "expression is not supported by csslit",
    label: "unsupported expression kind",
    note: "this most likely indicates a gap in csslit itself",
    help: "report this at https://github.com/csslit/csslit/issues",
  },
};

function expressionHeadline(issue: ExpressionIssue) {
  if ("binding" in issue) {
    const bindingKind = issue.code === "captured-binding-mutation" ? "captured binding" : "binding";
    return `cannot modify ${bindingKind} \`${issue.binding}\` during CSS evaluation`;
  }

  return expressionDescriptions[issue.code].headline;
}

const variableDescriptions: Record<DiagnosticPredicateCode, VariableDiagnosticDescription> = {
  "runtime-parameter": {
    headline: (name) => `runtime parameter \`${name}\` is unavailable during CSS evaluation`,
    label: () => "only exists when this function is called",
    note: "CSS literals are evaluated independently at build time",
  },
  "class-binding": {
    headline: () => "classes are not supported during CSS evaluation",
    label: () => "declared as a class",
    help: "declare the class in a separate module and import it",
  },
  "catch-binding": {
    headline: (name) => `catch binding \`${name}\` is unavailable during CSS evaluation`,
    label: () => "only exists while the catch block runs",
    note: "CSS literals are evaluated independently at build time",
  },
  reassigned: {
    headline: (name) => `binding \`${name}\` does not provide a stable CSS value`,
    label: () => "reassigned here",
    note: "bindings used by CSS must retain one value",
  },
  "loop-binding": {
    headline: (name) => `loop binding \`${name}\` is unavailable during CSS evaluation`,
    label: () => "only exists for a loop iteration",
    note: "CSS literals are evaluated independently at build time",
  },
  "no-initializer": {
    headline: (name) => `binding \`${name}\` has no initializer`,
    label: () => "declared without a value",
  },
  "enum-declaration": {
    headline: () => "TypeScript enums are not supported during CSS evaluation",
    label: () => "declared as an enum",
    help: "move the enum to a separate module and import it",
  },
  "namespace-declaration": {
    headline: () => "TypeScript namespaces are not supported during CSS evaluation",
    label: () => "declared as a namespace",
  },
  "unknown-local-binding-kind": {
    headline: (name) => `binding \`${name}\` is not supported during CSS evaluation`,
    label: () => "this kind of local binding cannot be extracted",
  },
  "not-value-binding": {
    headline: (name) => `\`${name}\` does not refer to a runtime value`,
    label: () => "type-only bindings cannot be used as CSS values",
  },
  "used-before-initializer": {
    headline: (name) => `binding \`${name}\` is read before its initializer runs`,
    label: () => "initializer has not run yet",
  },
};

function formatHeadline(diagnostic: EvalDiagnostic) {
  const rootCause = diagnostic.rootCause;
  switch (rootCause.kind) {
    case "thrown": {
      const suffix = rootCause.text ? `: ${rootCause.text}` : "";
      const primary = diagnostic.dependencies[0];
      if (primary) {
        return `evaluating \`${primary.name}\` threw${suffix}`;
      }
      return `evaluation threw${suffix}`;
    }
    case "expression": {
      return expressionHeadline(rootCause.issue);
    }
    case "variable": {
      return variableDescriptions[rootCause.predicate].headline(rootCause.name);
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

function spanContainsSpan(outer: Span, inner: Span) {
  return spanContainsLocation(outer, inner.start) && spanContainsLocation(outer, inner.end);
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
  // Underlining a span that stretches over many lines drowns the frame in
  // carets, and clamping it mid-span would suggest an unintended boundary, so
  // point at where the span starts instead.
  if (span.end.row - span.start.row > 2) {
    span = { start: span.start, end: span.start };
  }

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

function appendAdvice(frame: string, description: DiagnosticAdvice) {
  if (description.note) frame += `\n\n= note: ${description.note}`;
  if (description.help) {
    frame += `${description.note ? "\n" : "\n\n"}= help: ${description.help}`;
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
          `references \`${primary.name}\``,
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
      const description = variableDescriptions[rootCause.predicate];

      let frame = formatSection(
        "Interpolation",
        options.sourceFile,
        primary.reference,
        `references \`${primary.name}\``,
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
          description.label(rootCause.name),
          options,
        );

      return appendAdvice(frame, description);
    }
    case "expression": {
      const description = expressionDescriptions[rootCause.issue.code];
      if (dependencies.length === 0) {
        let frame;
        if (spanContainsSpan(diagnostic.interpolation, rootCause.source)) {
          frame = formatSection(
            "Interpolation",
            options.sourceFile,
            rootCause.source,
            description.label,
            options,
          );
        } else {
          frame = formatSection(
            "Interpolation",
            options.sourceFile,
            diagnostic.interpolation,
            "evaluation reaches rejected code",
            options,
          );
          frame +=
            "\n\n" +
            formatSection(
              "Root cause",
              options.sourceFile,
              rootCause.source,
              description.label,
              options,
            );
        }

        return appendAdvice(frame, description);
      } else {
        let deps = [...dependencies];
        const primary = deps.shift()!;
        let frame = formatSection(
          "Interpolation",
          options.sourceFile,
          primary.reference,
          `references \`${primary.name}\``,
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
            description.label,
            options,
          );

        return appendAdvice(frame, description);
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

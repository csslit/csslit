import { formatDiagnostic } from "@csslit/transform";
import type { DiagnosticAnnotation, DiagnosticSource } from "@csslit/transform";

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
  callee?: string;
  location?: FileLocation;
}

interface StackFrame {
  callee?: string;
  file: string;
  location: Location;
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

export type RawExpressionIssue =
  | {
      code: Exclude<ExpressionCode, BindingMutationExpressionCode>;
    }
  | {
      code: BindingMutationExpressionCode;
      binding: string;
      declaration?: string;
      closure?: string;
    };

export type ExpressionIssue =
  | {
      code: Exclude<ExpressionCode, BindingMutationExpressionCode>;
    }
  | {
      code: BindingMutationExpressionCode;
      binding: string;
      declaration?: Span;
      closure?: Span;
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
    label: "modifies the object",
    note: "objects used during CSS evaluation are assumed to remain unchanged",
  },
  "call-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "return value may not be stable",
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
    label: "may change later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting array is stable",
  },
  "binding-mutation-outside-closure": {
    headline: "cannot modify binding during CSS evaluation",
    label: "modified here",
    note: "stateful calculations must be contained in closure-local bindings",
  },
  "captured-binding-mutation": {
    headline: "cannot modify captured binding during CSS evaluation",
    label: "modified here",
    note: "closures may read captured bindings, but may only modify their own locals",
  },
  "property-mutation": {
    headline: "cannot modify an object property during CSS evaluation",
    label: "modified here",
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
    label: "may change later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting instance is stable",
  },
  "object-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "may change later",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that the resulting object is stable",
  },
  "sequence-expression": {
    headline: "expression is not known to produce a stable CSS value",
    label: "result may not be stable",
    note: stableValueNote,
    help: "wrap this expression in `comptime(...)` to assert that its result is stable",
  },
  "tagged-template": {
    headline: "expression is not known to produce a stable CSS value",
    label: "return value may not be stable",
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
    label: () => "unsupported binding kind",
  },
  "not-value-binding": {
    headline: (name) => `\`${name}\` does not refer to a runtime value`,
    label: () => "type-only binding",
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
): { location?: Location; frames: StackFrame[] } {
  let location: Location | undefined;
  const frames: StackFrame[] = [];

  const lines = stack.split("\n");
  lines.shift();

  for (const line of lines) {
    const stackLine = options.normalizeStackLine(line);
    if (!stackLine) {
      break;
    }

    const fileLocation = stackLine.location;
    if (!fileLocation) {
      continue;
    }
    if (fileLocation.file === file && spanContainsLocation(span, fileLocation.location)) {
      location = fileLocation.location;
      break;
    }
    frames.push({
      callee: stackLine.callee,
      file: fileLocation.file,
      location: fileLocation.location,
    });
  }

  return {
    location,
    frames,
  };
}

function isSameFrame(a: StackFrame, b: StackFrame) {
  return (
    a.callee === b.callee &&
    a.file === b.file &&
    a.location.row === b.location.row &&
    a.location.col === b.location.col
  );
}

function stackFrameSources(frames: StackFrame[], options: ErrorOptions): DiagnosticSource[] {
  const sources: DiagnosticSource[] = [];
  // The snippets continue the dependency chain from the interpolation towards
  // the throw site, so callers come before callees.
  const chain = [...frames].reverse();

  for (let index = 0; index < chain.length;) {
    const frame = chain[index]!;
    let run = 1;
    while (index + run < chain.length && isSameFrame(frame, chain[index + run]!)) {
      run += 1;
    }
    index += run;

    let source;
    try {
      source = options.readSource(frame.file);
    } catch {
      // The frame may be in a virtual module with no readable source.
      continue;
    }

    const insideLabel = frame.callee ? `inside \`${frame.callee}\`` : "called from here";
    const labels: string[] = [];
    if (run > 3) {
      labels.push(
        `[... ${run - 1} additional calls${frame.callee ? ` inside \`${frame.callee}\`` : ""} ...]`,
      );
    } else {
      for (let copy = 1; copy < run; copy += 1) {
        labels.push(insideLabel);
      }
    }
    labels.push(
      index === chain.length
        ? `thrown here${frame.callee ? `, inside \`${frame.callee}\`` : ""}`
        : insideLabel,
    );

    for (const label of labels) {
      sources.push({
        annotations: [
          {
            label,
            primary: false,
            span: { start: frame.location, end: frame.location },
          },
        ],
        path: frame.file,
        source,
      });
    }
  }

  return sources;
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

function dependencyAnnotations(dependencies: Dependency[]): DiagnosticAnnotation[] {
  return dependencies.map((dependency, index) => ({
    label:
      index === 0
        ? `CSS reads \`${dependency.name}\``
        : `evaluating \`${dependencies[index - 1]!.name}\` reads \`${dependency.name}\``,
    primary: index === 0,
    span: dependency.reference,
  }));
}

function formatFrame(
  diagnostic: EvalDiagnostic,
  name: string,
  source: string,
  options: ErrorOptions,
) {
  const dependencies = diagnostic.dependencies;
  const rootCause = diagnostic.rootCause;
  const annotations = dependencyAnnotations(dependencies);
  const extraSources: DiagnosticSource[] = [];
  let advice: DiagnosticAdvice = {};

  switch (rootCause.kind) {
    case "thrown": {
      let thrownLocation = rootCause.source.start;
      if (rootCause.stack) {
        const analyzedStack = analyzeThrownStack(
          rootCause.stack,
          options.sourceFile,
          rootCause.source,
          options,
        );
        if (analyzedStack.location) {
          thrownLocation = analyzedStack.location;
        }
        extraSources.push(...stackFrameSources(analyzedStack.frames, options));
      }

      annotations.push({
        label: rootCause.text,
        primary: dependencies.length === 0,
        span: { start: thrownLocation, end: thrownLocation },
      });
      break;
    }
    case "variable": {
      if (dependencies.length === 0)
        throw new Error("Expected variable issue to have at least one dependency");

      const description = variableDescriptions[rootCause.predicate];
      annotations.push({
        label: description.label(rootCause.name),
        primary: false,
        span: rootCause.source,
      });
      advice = description;
      break;
    }
    case "expression": {
      const description = expressionDescriptions[rootCause.issue.code];
      if (dependencies.length === 0) {
        if (spanContainsSpan(diagnostic.interpolation, rootCause.source)) {
          annotations.push({
            label: description.label,
            primary: true,
            span: rootCause.source,
          });
        } else {
          annotations.push(
            {
              label: "evaluation reaches rejected code",
              primary: true,
              span: diagnostic.interpolation,
            },
            {
              label: description.label,
              primary: false,
              span: rootCause.source,
            },
          );
        }
      } else {
        annotations.push({
          label: description.label,
          primary: false,
          span: rootCause.source,
        });
      }

      if ("declaration" in rootCause.issue && rootCause.issue.declaration) {
        annotations.push({
          label: "declared here",
          primary: false,
          span: rootCause.issue.declaration,
        });
      }
      if (
        "closure" in rootCause.issue &&
        rootCause.issue.closure &&
        rootCause.issue.closure.start.row !== rootCause.source.start.row
      ) {
        annotations.push({
          label: "captured by this function",
          primary: false,
          span: rootCause.issue.closure,
        });
      }
      advice = description;
      break;
    }
    default:
      assertNever(rootCause, "Unsupported csslit root cause");
  }

  const frame = formatDiagnostic({
    helps: advice.help ? [advice.help] : [],
    name,
    notes: advice.note ? [advice.note] : [],
    sources: [
      {
        annotations,
        path: options.sourceFile,
        source,
      },
      ...extraSources,
    ],
    title: formatHeadline(diagnostic),
  });

  const primary = annotations.find((annotation) => annotation.primary);
  return { frame, primary: primary?.span ?? diagnostic.interpolation };
}

function buildSingleCsslitError(
  diagnostic: EvalDiagnostic,
  name: string,
  source: string,
  options: ErrorOptions,
): BuiltError {
  const { frame, primary } = formatFrame(diagnostic, name, source, options);

  return {
    frame,
    loc: {
      file: options.sourceFile,
      line: primary.start.row + 1,
      column: primary.start.col + 1,
    },
    message: formatHeadline(diagnostic),
  };
}

export function buildCsslitError(diagnostics: EvalDiagnostic[], options: ErrorOptions): BuiltError {
  const displayedDiagnostics = diagnostics.slice(0, 5);
  const source = options.readSource(options.sourceFile);
  const first = buildSingleCsslitError(diagnostics[0]!, "error", source, options);

  const omitted = diagnostics.length - displayedDiagnostics.length;
  let frame = displayedDiagnostics
    .map((diagnostic, index) => {
      const name = diagnostics.length === 1 ? "error" : `error ${index + 1}`;
      const error = buildSingleCsslitError(diagnostic, name, source, options);
      return `${index === 0 ? "\n" : ""}${error.frame.trimEnd()}`;
    })
    .join(diagnostics.length === 1 ? "\n" : "\n\n");
  if (omitted > 0) {
    frame += `\n\n... ${omitted} more ${omitted === 1 ? "error" : "errors"} not shown`;
  }

  return {
    frame,
    loc: first.loc,
    message:
      diagnostics.length === 1
        ? first.message
        : `${diagnostics.length} CSS evaluation errors: ${first.message} (+${diagnostics.length - 1} more)`,
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

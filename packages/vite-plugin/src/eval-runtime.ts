import type {
  CsslitChainSubject,
  CsslitCollectedEvalDiagnostic,
  CsslitEvalError,
  CsslitEvalLocationToken,
  CsslitIssue,
} from "./eval-error";

function patchMappings(mappings: string, patches: { line: number; count: number }[]) {
  if (patches.length === 0) {
    return mappings;
  }

  let result = "";
  let cursor = 0;
  let line = 0;
  let patchIndex = 0;

  while (true) {
    while (patchIndex < patches.length && patches[patchIndex]!.line === line) {
      result += ";".repeat(patches[patchIndex]!.count);
      patchIndex += 1;
    }

    const end = mappings.indexOf(";", cursor);
    if (end === -1) {
      result += mappings.slice(cursor);
      break;
    }

    result += mappings.slice(cursor, end + 1);
    cursor = end + 1;
    line += 1;
  }

  return result;
}

export type {
  CsslitEvalError,
  CsslitEvalLocation,
  CsslitEvalLocationToken,
} from "./eval-error";

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

type CsslitInputLocation = {
  file?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
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

function createIssueDiagnostic(
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

function createStepDiagnostic(
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

function getErrorStack(error: unknown) {
  if (error instanceof Error) {
    return error.stack;
  }

  if (typeof error === "object" && error !== null && "stack" in error) {
    const { stack } = error;
    if (typeof stack === "string") {
      return stack;
    }
  }

  return undefined;
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

function getThrownValueInfo(error: unknown) {
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

function decodeLocationToken(token: CsslitEvalLocationToken): CsslitInputLocation {
  const [line, column, endLine, endColumn] = token.split(":", 4).map(Number);
  invariant(
    [line, column, endLine, endColumn].every(Number.isFinite),
    `Malformed csslit location token: ${token}`,
  );
  return { line, column, endLine, endColumn };
}

function buildCsslitDiagnosticData(error: unknown): CsslitEvalError {
  const diagnostics: CsslitDiagnostic[] = [];
  let current: unknown = error;

  while (isCsslitDiagnostic(current)) {
    diagnostics.push(current);
    current = current.cause;
  }

  const chain: CsslitCollectedEvalDiagnostic["chain"] = [];
  let thrownLoc: CsslitInputLocation | undefined = undefined;

  if (diagnostics.length > 0) {
    const rootDiagnostic = diagnostics[diagnostics.length - 1];
    const rootInfo = rootDiagnostic[CSSLIT_DIAGNOSTIC];

    for (const entry of diagnostics) {
      const info = entry[CSSLIT_DIAGNOSTIC];
      switch (info.kind) {
        case "step": {
          chain.push({ subject: info.subject, loc: info.loc });
          break;
        }
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
      chain,
      rootCause: {
        kind: "thrown",
        rawCause: current,
        loc: thrownLoc ?? getErrorLocation(current),
        stack: thrown.stack,
        thrownValue: thrown.thrownValue,
      },
    },
  };
}

export function init() {
  const blocks: { code: string; patches: { line: number; count: number }[] }[] = [];
  const deferred: Array<() => void> = [];
  const errors: CsslitEvalError[] = [];

  function err(
    issue: CsslitIssue,
    loc: CsslitEvalLocationToken,
    rootLoc?: CsslitEvalLocationToken,
  ): never {
    throw createIssueDiagnostic(issue, loc, rootLoc);
  }

  function memo<T>(name: string, loc: CsslitEvalLocationToken, factory: () => T) {
    let state: "resolved" | "rejected";
    let resolvedValue: T;
    let rejectedCause: unknown;

    try {
      resolvedValue = factory();
      state = "resolved";
    } catch (error) {
      rejectedCause = error;
      state = "rejected";
    }

    return (useLoc: CsslitEvalLocationToken) => {
      if (state === "resolved") {
        return resolvedValue;
      }

      throw createStepDiagnostic({ name }, useLoc, rejectedCause, loc);
    };
  }

  function memoErr(name: string, issue: CsslitIssue, loc: CsslitEvalLocationToken) {
    return (useLoc: CsslitEvalLocationToken) => {
      const issueError = createIssueDiagnostic(issue, loc, loc);
      throw createStepDiagnostic({ name }, useLoc, issueError, loc);
    };
  }

  function callMemo<T>(
    name: string,
    maybeMemo: ((useLoc: CsslitEvalLocationToken) => T) | undefined,
    useLoc: CsslitEvalLocationToken,
    initLoc: CsslitEvalLocationToken,
  ) {
    if (maybeMemo === undefined) {
      return err({ kind: "variable", name, predicate: "used-before-initializer" }, useLoc, initLoc);
    }

    return maybeMemo(useLoc);
  }

  function capture(loc: CsslitEvalLocationToken, expression: () => unknown) {
    try {
      return String(expression());
    } catch (error) {
      const normalized = buildCsslitDiagnosticData(error);
      normalized.diagnostic.interpolation = decodeLocationToken(loc);
      errors.push(normalized);
      return `/* csslit error ${errors.length} */`;
    }
  }

  function css(block: { patch_lines: number[] }) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      let code = "";
      const patches: { line: number; count: number }[] = [];

      for (let index = 0; index < strings.length; index += 1) {
        code += strings[index] ?? "";

        if (index >= values.length) continue;

        const value = String(values[index]);
        code += value;

        const count = value.match(/\r\n?|\n/g)?.length ?? 0;
        const line = block.patch_lines[index];

        if (count > 0 && typeof line === "number") {
          patches.push({ line, count });
        }
      }

      blocks.push({ code, patches });
    };
  }

  function defer(task: () => void) {
    deferred.push(task);
  }

  function finalize(map: { mappings: string } | null) {
    while (deferred.length > 0) {
      const task = deferred.shift();
      if (task) task();
    }

    let code = "";
    const patches: { line: number; count: number }[] = [];

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      let blockCode = block.code;

      if (!blockCode.startsWith("\n")) {
        blockCode = `\n${blockCode}`;
      }

      if (!blockCode.endsWith("\n")) {
        blockCode += "\n";
      }

      code += `.csslit_${index} {${blockCode}}\n\n`;
      patches.push(...block.patches);
    }

    return {
      code,
      errors,
      map: map ? { ...map, mappings: patchMappings(map.mappings, patches) } : null,
    };
  }

  return {
    callMemo,
    capture,
    css,
    defer,
    err,
    finalize,
    memo,
    memoErr,
  };
}

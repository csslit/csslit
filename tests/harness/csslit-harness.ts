import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, TestRunner } from "vite-plus/test";
import { buildErrorMessage, createBuilder, createServer, normalizePath } from "vite";
import type { PluginOption } from "vite";
import type { RollupError, RolldownOutput } from "rolldown";
import csslit from "@csslit/vite-plugin";
import type { CsslitModuleType } from "@csslit/vite-plugin";

const ROOT_TOKEN = "<root>";
const REPO_ROOT = normalizePath(path.resolve(import.meta.dirname, "../.."));
const TESTS_ROOT = normalizePath(path.resolve(import.meta.dirname, ".."));
const FIXTURES_ROOT = normalizePath(path.resolve(TESTS_ROOT, "fixtures"));

type SnapshotCssModule = {
  code: string;
  id?: string;
};

type SnapshotJsModule = {
  code: string;
  id?: string;
};

type CsslitSnapshotReportData = {
  css?: SnapshotCssModule[];
  js?: SnapshotJsModule[];
};

class CsslitSnapshotReport {
  readonly css?: SnapshotCssModule[];
  readonly js?: SnapshotJsModule[];

  constructor({ css, js }: CsslitSnapshotReportData) {
    this.css = css;
    this.js = js;
  }
}

class CsslitErrorSnapshot {
  readonly error: string;

  constructor(error: string) {
    this.error = error;
  }
}

function renderSnapshotReport(report: CsslitSnapshotReport) {
  let output = '"\n';
  let hasContent = false;

  for (const jsModule of report.js ?? []) {
    if (hasContent) {
      output += "\n";
    }

    output += jsModule.id ? `# js ${normalizeSnapshotText(jsModule.id)}\n` : "# js\n";

    output += normalizeSnapshotText(stripSourceMapComment(jsModule.code));
    if (!output.endsWith("\n")) {
      output += "\n";
    }

    hasContent = true;
  }

  for (const cssModule of report.css ?? []) {
    if (hasContent) {
      output += "\n";
    }

    output += cssModule.id ? `# css ${normalizeSnapshotText(cssModule.id)}\n` : "# css\n";

    output += normalizeSnapshotText(stripCssSourceMapComment(cssModule.code));
    if (!output.endsWith("\n")) {
      output += "\n";
    }

    hasContent = true;
  }

  return `${output}"`;
}

function renderErrorSnapshot(snapshot: CsslitErrorSnapshot) {
  return `"\nerror: ${normalizeDiagnosticText(snapshot.error)}\n"`;
}

expect.addSnapshotSerializer({
  test: (value) => value instanceof CsslitSnapshotReport,
  serialize: (value) => renderSnapshotReport(value as CsslitSnapshotReport),
});

expect.addSnapshotSerializer({
  test: (value) => value instanceof CsslitErrorSnapshot,
  serialize: (value) => renderErrorSnapshot(value as CsslitErrorSnapshot),
});

type FixtureFiles = Record<`/${string}`, string>;

type HarnessCase = {
  cssDevSourcemap?: boolean;
  entry: `/${string}`;
  files: FixtureFiles;
  moduleType?: Record<string, CsslitModuleType>;
  plugins?: PluginOption[];
  root?: `/${string}`;
};

function dedent(raw: string) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim().length > 0);
  const end = [...lines].reverse().findIndex((line) => line.trim().length > 0);

  if (start === -1) {
    return "";
  }

  const trimmedLines = lines.slice(start, lines.length - end);
  const indent = trimmedLines
    .filter((line) => line.trim().length > 0)
    .reduce((smallest, line) => {
      const width = line.match(/^\s*/u)?.[0].length ?? 0;
      return Math.min(smallest, width);
    }, Number.POSITIVE_INFINITY);

  return trimmedLines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

function normalizeInputFiles(files: FixtureFiles): FixtureFiles {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, code]) => [file, dedent(code)]),
  ) as FixtureFiles;
}

function absolutizeFile(file: string, root: string) {
  return normalizePath(path.resolve(root, `.${file}`));
}

function fixtureRoot() {
  const test = TestRunner.getCurrentTest()!;
  const relativeFile = normalizePath(path.relative(TESTS_ROOT, test.file.filepath));
  const file = relativeFile.replace(/\.(?:spec|test)\.[^./]+$/u, "");
  const fullName = test.fullName.startsWith(`${relativeFile} > `)
    ? test.fullName.slice(relativeFile.length + 3)
    : test.fullName;
  const identity = `${file}\0${fullName}`;
  const name = `${file}-${fullName}`
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 100);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 8);

  return normalizePath(path.resolve(FIXTURES_ROOT, `${name}-${hash}`));
}

async function materializeFixture(files: FixtureFiles, root: string) {
  const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");

  if ((await readFile(path.resolve(root, ".fixture-hash"), "utf8").catch(() => null)) === hash) {
    return root;
  }

  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
  for (const [file, code] of Object.entries(files)) {
    const filename = absolutizeFile(file, root);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, code);
  }
  await writeFile(path.resolve(root, ".fixture-hash"), hash);

  return root;
}

function stripSourceMapComment(code: string) {
  return code
    .replace(/\n\/\*# sourceMappingURL=[\s\S]*?\*\/\s*$/u, "")
    .replace(/\n\/\/[#@] sourceMappingURL=.*$/gmu, "")
    .replace(/\r\n?/g, "\n");
}

function extractVirtualCssIds(code: string) {
  return [...new Set(code.match(/(?:\/|[A-Za-z]:\/)[^"'`]+?\.csslit\.css/g) ?? [])].map(
    normalizePath,
  );
}

function extractVirtualCssModuleJsIds(code: string) {
  return [...new Set(code.match(/(?:\/|[A-Za-z]:\/)[^"'`]+?\.csslit\.module\.js/g) ?? [])].map(
    normalizePath,
  );
}

function unwrapPublicId(id: string) {
  return id.startsWith("/@id/") ? normalizePath(decodeURIComponent(id.slice(5))) : id;
}

function normalizeSnapshotText(value: string, root = fixtureRoot()) {
  let normalized = value.replace(/\r\n?/g, "\n");

  for (const absoluteRoot of [normalizePath(root), normalizePath(path.resolve(root)), REPO_ROOT]) {
    const encodedRoot = encodeURIComponent(absoluteRoot);

    normalized = normalized
      .replaceAll(encodedRoot, encodeURIComponent(ROOT_TOKEN))
      .replaceAll(absoluteRoot, ROOT_TOKEN);
  }

  normalized = normalized
    .replace(/\?v=[a-f0-9]+/gu, "")
    .replaceAll(normalizePath(path.relative(REPO_ROOT, root)), ROOT_TOKEN)
    .replaceAll(normalizePath(path.relative(TESTS_ROOT, root)), ROOT_TOKEN);

  return normalized;
}

function normalizeDiagnosticText(value: string) {
  return normalizeSnapshotText(
    value
      // oxlint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replaceAll("\\", "/")
      .replaceAll("`", "'")
      .replaceAll("${", "#{"),
  ).replace(/^error:\s*/u, "");
}

function formatError(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    return String(error);
  }

  return buildErrorMessage(error as RollupError, [`error: ${error.message}`], false);
}

let runCsslitCaseQueue: Promise<unknown> = Promise.resolve();

async function runCsslitCaseIsolated(
  input: HarnessCase,
  fileRoot: string,
): Promise<CsslitSnapshotReportData> {
  const files = normalizeInputFiles(input.files);
  await materializeFixture(files, fileRoot);
  const serverRoot = input.root ? absolutizeFile(input.root, fileRoot) : fileRoot;
  let hasWarned = false;
  const server = await createServer({
    appType: "custom",
    css: {
      devSourcemap: input.cssDevSourcemap,
    },
    customLogger: {
      clearScreen() {},
      error() {},
      hasErrorLogged() {
        return false;
      },
      get hasWarned() {
        return hasWarned;
      },
      info() {},
      warn(message) {
        hasWarned = true;
        throw new Error(`Unexpected Vite warning: ${message}`);
      },
      warnOnce(message) {
        hasWarned = true;
        throw new Error(`Unexpected Vite warning: ${message}`);
      },
    },
    logLevel: "silent",
    plugins: [input.plugins, csslit({ moduleType: input.moduleType })],
    root: serverRoot,
    server: {
      hmr: false,
      middlewareMode: true,
    },
  });

  try {
    const jsModules: SnapshotJsModule[] = [];
    const cssModules: SnapshotCssModule[] = [];

    for (const file of Object.keys(files).sort()) {
      const sourceResult = await server.transformRequest(absolutizeFile(file, fileRoot));
      if (!sourceResult) {
        throw new Error(`No transform result for ${file}`);
      }
      jsModules.push({ code: sourceResult.code, id: file });

      for (const publicModuleId of extractVirtualCssModuleJsIds(sourceResult.code)) {
        const resolvedModuleId = unwrapPublicId(publicModuleId);
        const moduleResult = await server.transformRequest(resolvedModuleId);
        const code = moduleResult?.code ?? "";
        jsModules.push({ code, id: `${file}.csslit.module.js` });

        for (const publicCssId of extractVirtualCssIds(code)) {
          const resolvedCssId = unwrapPublicId(publicCssId);
          const cssResult = await server.transformRequest(resolvedCssId);
          cssModules.push(parseCssSnapshot(cssResult?.code ?? "", resolvedCssId));
        }
      }
    }

    return {
      css: cssModules.length > 0 ? cssModules : undefined,
      js: jsModules,
    };
  } finally {
    // Vite can deadlock during close if an optimized dependency request is still waiting for the
    // optimizer's processing promise. Wait for the import crawl until vitejs/vite#22934 is fixed.
    // https://github.com/vitejs/vite/issues/22934
    await server.environments["client"]!.waitForRequestsIdle();
    await server.close();
  }
}

async function runCsslitProductionBuildIsolated(
  input: HarnessCase,
  fileRoot: string,
): Promise<CsslitSnapshotReportData> {
  const files = normalizeInputFiles(input.files);
  await materializeFixture(files, fileRoot);
  const entryId = absolutizeFile(input.entry, fileRoot);
  const serverRoot = input.root ? absolutizeFile(input.root, fileRoot) : fileRoot;
  let hasWarned = false;
  const builder = await createBuilder({
    appType: "custom",
    build: {
      cssCodeSplit: true,
      lib: {
        entry: entryId,
      },
      minify: false,
      rolldownOptions: {
        experimental: {
          attachDebugInfo: "none",
        },
      },
      write: false,
    },
    customLogger: {
      clearScreen() {},
      error() {},
      hasErrorLogged() {
        return false;
      },
      get hasWarned() {
        return hasWarned;
      },
      info() {},
      warn(message) {
        hasWarned = true;
        throw new Error(`Unexpected Vite warning: ${message}`);
      },
      warnOnce(message) {
        hasWarned = true;
        throw new Error(`Unexpected Vite warning: ${message}`);
      },
    },
    logLevel: "silent",
    plugins: [input.plugins, csslit({ moduleType: input.moduleType })],
    root: serverRoot,
  });

  const lib = builder.environments["client"]!.config.build.lib;
  if (lib) {
    lib.formats = ["es"];
  }

  let result: Awaited<ReturnType<typeof builder.build>>;
  try {
    result = await builder.build(builder.environments["client"]!);
  } finally {
    await (
      builder.environments["comptime"] as { close?: () => Promise<void> } | undefined
    )?.close?.();
  }

  const js: SnapshotJsModule[] = [];
  const css: SnapshotCssModule[] = [];

  for (const entry of (Array.isArray(result) ? result : [result]) as RolldownOutput[]) {
    for (const output of entry.output) {
      if (output.type === "chunk") {
        js.push({
          code: output.code,
        });
      } else if (output.fileName.endsWith(".css")) {
        css.push({
          code:
            typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source).toString("utf8"),
        });
      }
    }
  }

  return {
    css: css.length > 0 ? css : undefined,
    js: js.length > 0 ? js : undefined,
  };
}

function compactSnapshotPath(value: string) {
  return normalizeSnapshotText(value)
    .replace(/\/[@]id\/<root>(\/[^\s"'`)]+?\.csslit\.module\.js)/g, "$1")
    .replace(/\/[@]id\/<root>(\/[^\s"'`)]+?\.csslit\.module\.css)/g, "$1")
    .replace(/\/[@]id\/<root>(\/[^\s"'`)]+?\.csslit\.global\.css)/g, "$1")
    .replace(/\/[@]id\/<root>(\/[^\s"'`)]+?\.csslit\.css)/g, "$1")
    .replace(/<root>(\/[^\s"'`)]+?\.csslit\.module\.css)/g, "$1")
    .replace(/<root>(\/[^\s"'`)]+?\.csslit\.global\.css)/g, "$1")
    .replace(/<root>(\/[^\s"'`)]+?\.csslit\.css)/g, "$1");
}

function parseCssSnapshot(code: string, id: string): SnapshotCssModule {
  const cssLiteral = code.match(/const __vite__css = ("(?:\\.|[^"\\])*")/u)?.[1];
  if (!cssLiteral) {
    throw new Error(`Expected Vite CSS wrapper for ${id}`);
  }

  return {
    code: JSON.parse(cssLiteral) as string,
    id: compactSnapshotPath(id),
  };
}

function stripCssSourceMapComment(css: string) {
  return css.replace(/\n?\/\*# sourceMappingURL=[\s\S]*?\*\/\s*$/u, "");
}

export async function build(input: HarnessCase) {
  const root = fixtureRoot();
  const currentRun = runCsslitCaseQueue.then(() => runCsslitCaseIsolated(input, root));
  runCsslitCaseQueue = currentRun.catch(() => {});
  return currentRun;
}

export async function buildSnapshot(input: HarnessCase) {
  const result = await build(input);
  return new CsslitSnapshotReport(result);
}

export async function buildErrorSnapshot(input: HarnessCase) {
  try {
    await build(input);
  } catch (error) {
    return new CsslitErrorSnapshot(formatError(error));
  }

  throw new Error("Expected csslit evaluation to fail");
}

export async function buildProduction(input: HarnessCase) {
  const root = fixtureRoot();
  const currentRun = runCsslitCaseQueue.then(() => runCsslitProductionBuildIsolated(input, root));
  runCsslitCaseQueue = currentRun.catch(() => {});
  return currentRun;
}

export async function buildProductionSnapshot(input: HarnessCase) {
  const result = await buildProduction(input);
  return new CsslitSnapshotReport(result);
}

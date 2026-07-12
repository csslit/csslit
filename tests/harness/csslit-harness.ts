import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { expect } from "vite-plus/test";
import { createBuilder, createServer, normalizePath } from "vite";
import type { Plugin } from "vite";
import type { RolldownOutput } from "rolldown";
import { csslitPlugin } from "@csslit/vite-plugin";

const ROOT_TOKEN = "<root>";
const REPO_ROOT = normalizePath(path.resolve(import.meta.dirname, "../.."));
const TESTS_ROOT = normalizePath(path.resolve(import.meta.dirname, ".."));
const SYNTHETIC_ROOT = normalizePath(path.resolve(path.sep, "__csslit_test_root__"));
const RESOLUTION_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;

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
  warnings?: string[];
};

class CsslitSnapshotReport {
  readonly css?: SnapshotCssModule[];
  readonly js?: SnapshotJsModule[];
  readonly warnings?: string[];

  constructor({ css, js, warnings }: CsslitSnapshotReportData) {
    this.css = css;
    this.js = js;
    this.warnings = warnings;
  }
}

class CsslitWarningSnapshot {
  readonly warnings?: string[];

  constructor(warnings?: string[]) {
    this.warnings = warnings;
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

  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    if (hasContent) {
      output += "\n";
    }

    output += "# warnings\n";
    for (let index = 0; index < warnings.length; index += 1) {
      if (index > 0) {
        output += "\n";
      }

      output += `warning: ${normalizeWarningText(warnings[index])}`;
      if (!output.endsWith("\n")) {
        output += "\n";
      }
    }
    hasContent = true;
  }

  return `${output}"`;
}

function renderWarningSnapshot(snapshot: CsslitWarningSnapshot) {
  if (!snapshot.warnings?.length) {
    return '""';
  }

  let output = '"\n';
  for (let index = 0; index < snapshot.warnings.length; index += 1) {
    if (index > 0) {
      output += "\n";
    }

    output += `warning: ${normalizeWarningText(snapshot.warnings[index])}`;
    if (!output.endsWith("\n")) {
      output += "\n";
    }
  }

  return `${output}"`;
}

expect.addSnapshotSerializer({
  test: (value) => value instanceof CsslitSnapshotReport,
  serialize: (value) => renderSnapshotReport(value as CsslitSnapshotReport),
});

expect.addSnapshotSerializer({
  test: (value) => value instanceof CsslitWarningSnapshot,
  serialize: (value) => renderWarningSnapshot(value as CsslitWarningSnapshot),
});

type VirtualFiles = Record<`/${string}`, string>;

type HarnessCase = {
  cssDevSourcemap?: boolean;
  entry: `/${string}`;
  files: VirtualFiles;
  plugins?: Plugin[];
  root?: `/${string}`;
  workspaceRooted?: boolean;
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

function normalizeInputFiles(files: VirtualFiles): VirtualFiles {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, code]) => [file, dedent(code)]),
  ) as VirtualFiles;
}

function absolutizeFile(file: string, root = SYNTHETIC_ROOT) {
  return normalizePath(path.resolve(root, `.${file}`));
}

function absolutizeFiles(files: VirtualFiles, root = SYNTHETIC_ROOT) {
  return new Map(Object.entries(files).map(([file, code]) => [absolutizeFile(file, root), code]));
}

function inferModuleType(id: string) {
  if (id.endsWith(".tsx")) return "tsx";
  if (id.endsWith(".ts")) return "ts";
  if (id.endsWith(".jsx")) return "jsx";
  return "js";
}

function normalizeFsPath(file: fs.PathOrFileDescriptor) {
  if (typeof file === "string") {
    return normalizePath(file);
  }

  if (file instanceof URL) {
    return normalizePath(file.pathname);
  }

  return null;
}

function installReadFileMock(files: Map<string, string>) {
  const original = fs.readFileSync;

  fs.readFileSync = ((
    file: fs.PathOrFileDescriptor,
    options?: BufferEncoding | null | { encoding?: BufferEncoding | null; flag?: string },
  ) => {
    const normalized = normalizeFsPath(file);
    if (normalized && files.has(normalized)) {
      const text = files.get(normalized) ?? "";
      const encoding =
        typeof options === "string"
          ? options
          : typeof options === "object" && options !== null && "encoding" in options
            ? options.encoding
            : undefined;

      if (!encoding || encoding === "utf8") {
        return text;
      }

      return Buffer.from(text);
    }

    return original(file, options as never);
  }) as typeof fs.readFileSync;

  syncBuiltinESMExports();

  return () => {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  };
}

function tryResolveVirtualId(base: string, files: Map<string, string>) {
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = normalizePath(`${base}${suffix}`);
    if (files.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveVirtualId(
  source: string,
  importer: string | undefined,
  files: Map<string, string>,
) {
  if (source.startsWith("\0") || source.startsWith("virtual:")) {
    return null;
  }

  if (source.startsWith("/")) {
    return tryResolveVirtualId(absolutizeFile(source), files);
  }

  if (path.isAbsolute(source)) {
    return tryResolveVirtualId(normalizePath(source), files);
  }

  if (importer && (source.startsWith("./") || source.startsWith("../"))) {
    return tryResolveVirtualId(normalizePath(path.resolve(path.dirname(importer), source)), files);
  }

  return null;
}

function virtualFilesPlugin(files: Map<string, string>) {
  return {
    name: "csslit-test-virtual-files",
    enforce: "pre",

    resolveId(source: string, importer: string | undefined) {
      return resolveVirtualId(source, importer, files);
    },

    load(id: string) {
      const normalizedId = normalizePath(id);
      const resolvedId = files.has(normalizedId)
        ? normalizedId
        : tryResolveVirtualId(normalizedId, files);
      const code = resolvedId ? files.get(resolvedId) : undefined;
      if (!code) {
        return null;
      }

      return {
        code,
        moduleType: inferModuleType(resolvedId ?? id),
      };
    },
  };
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

function normalizeSnapshotText(value: string, root = SYNTHETIC_ROOT) {
  let normalized = value.replace(/\r\n?/g, "\n");

  for (const absoluteRoot of [normalizePath(root), normalizePath(path.resolve(root)), REPO_ROOT]) {
    const encodedRoot = encodeURIComponent(absoluteRoot);

    normalized = normalized
      .replaceAll(encodedRoot, encodeURIComponent(ROOT_TOKEN))
      .replaceAll(absoluteRoot, ROOT_TOKEN);
  }

  return normalized.replace(/(?:[A-Za-z]:)?\/__csslit_test_root__/g, ROOT_TOKEN);
}

function normalizeWarningText(value: string) {
  return normalizeSnapshotText(
    value
      // oxlint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replaceAll("\\", "/")
      .replaceAll("`", "'")
      .replaceAll("${", "#{"),
  ).replace(/^warning:\s*/u, "");
}

let runCsslitCaseQueue: Promise<unknown> = Promise.resolve();

async function runCsslitCaseIsolated(input: HarnessCase): Promise<CsslitSnapshotReportData> {
  const fileRoot = input.workspaceRooted ? TESTS_ROOT : SYNTHETIC_ROOT;
  const files = normalizeInputFiles(input.files);
  const absoluteFiles = absolutizeFiles(files, fileRoot);
  const serverRoot = input.root ? absolutizeFile(input.root) : TESTS_ROOT;
  const warnings: string[] = [];
  const restoreReadFile = installReadFileMock(absoluteFiles);

  try {
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
          warnings.push(message);
        },
        warnOnce(message) {
          hasWarned = true;
          warnings.push(message);
        },
      },
      logLevel: "silent",
      plugins: [virtualFilesPlugin(absoluteFiles), ...(input.plugins ?? []), csslitPlugin()],
      root: serverRoot,
      server: {
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
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } finally {
      await server.close();
    }
  } finally {
    restoreReadFile();
  }
}

async function runCsslitProductionBuildIsolated(
  input: HarnessCase,
): Promise<CsslitSnapshotReportData> {
  const fileRoot = input.workspaceRooted ? TESTS_ROOT : SYNTHETIC_ROOT;
  const files = normalizeInputFiles(input.files);
  const absoluteFiles = absolutizeFiles(files, fileRoot);
  const entryId = absolutizeFile(input.entry, fileRoot);
  const serverRoot = input.root ? absolutizeFile(input.root) : TESTS_ROOT;
  const warnings: string[] = [];
  const restoreReadFile = installReadFileMock(absoluteFiles);

  try {
    let hasWarned = false;
    const builder = await createBuilder({
      appType: "custom",
      build: {
        minify: false,
        rollupOptions: {
          input: entryId,
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
          warnings.push(message);
        },
        warnOnce(message) {
          hasWarned = true;
          warnings.push(message);
        },
      },
      logLevel: "silent",
      plugins: [virtualFilesPlugin(absoluteFiles), ...(input.plugins ?? []), csslitPlugin()],
      root: serverRoot,
    });

    let result: Awaited<ReturnType<typeof builder.build>>;
    try {
      result = await builder.build(builder.environments.client);
    } finally {
      await (builder.environments.comptime as { close?: () => Promise<void> }).close?.();
    }

    const js: SnapshotJsModule[] = [];
    const css: SnapshotCssModule[] = [];

    for (const entry of (Array.isArray(result) ? result : [result]) as RolldownOutput[]) {
      for (const output of entry.output) {
        if (output.type === "chunk") {
          js.push({
            code: output.code,
            id: output.fileName,
          });
        } else if (output.fileName.endsWith(".css")) {
          css.push({
            code:
              typeof output.source === "string"
                ? output.source
                : Buffer.from(output.source).toString("utf8"),
            id: output.fileName,
          });
        }
      }
    }

    return {
      css: css.length > 0 ? css : undefined,
      js: js.length > 0 ? js : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } finally {
    restoreReadFile();
  }
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
  const currentRun = runCsslitCaseQueue.then(() => runCsslitCaseIsolated(input));
  runCsslitCaseQueue = currentRun.catch(() => {});
  return currentRun;
}

export async function buildSnapshot(input: HarnessCase) {
  const result = await build(input);
  return new CsslitSnapshotReport(result);
}

export async function buildWarningSnapshot(input: HarnessCase) {
  const result = await build(input);
  return new CsslitWarningSnapshot(result.warnings);
}

export async function buildProduction(input: HarnessCase) {
  const currentRun = runCsslitCaseQueue.then(() => runCsslitProductionBuildIsolated(input));
  runCsslitCaseQueue = currentRun.catch(() => {});
  return currentRun;
}

export async function buildProductionSnapshot(input: HarnessCase) {
  const result = await buildProduction(input);
  return new CsslitSnapshotReport(result);
}

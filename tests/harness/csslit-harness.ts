import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { expect } from "vite-plus/test";
import { createServer, normalizePath } from "vite-plus";
import { cssCompilePlugin } from "@csslit/vite-plugin";

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
  css: string;
  id: string;
  exports?: Record<string, string>;
};

type CsslitSnapshotReportData = {
  cssModules?: SnapshotCssModule[];
  js?: string;
  warnings?: string[];
};

class CsslitSnapshotReport {
  readonly cssModules?: SnapshotCssModule[];
  readonly js?: string;
  readonly warnings?: string[];

  constructor({ cssModules, js, warnings }: CsslitSnapshotReportData) {
    this.cssModules = cssModules;
    this.js = js;
    this.warnings = warnings;
  }
}

function createSnapshotReport(data: CsslitSnapshotReportData) {
  return new CsslitSnapshotReport({
    cssModules: data.cssModules,
    js: data.js?.replace(/\r\n?/g, "\n"),
    warnings: data.warnings?.map((warning) => warning.replace(/\r\n?/g, "\n")),
  });
}

function renderSnapshotReport(report: CsslitSnapshotReport) {
  let output = '"';
  let hasContent = false;

  if (report.js) {
    output += `\n# js\n${report.js}`;
    hasContent = true;
  }

  for (const cssModule of report.cssModules ?? []) {
    if (hasContent) {
      output += "\n";
    }

    output += `\n# css ${cssModule.id}\n${cssModule.css}`;
    hasContent = true;

    if (cssModule.exports && Object.keys(cssModule.exports).length > 0) {
      output += "\n\n# exports";

      for (const [name, value] of Object.entries(cssModule.exports).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        output += `\n${name} = ${value}`;
      }
    }
  }

  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    if (report.js || (report.cssModules?.length ?? 0) > 0) {
      if (hasContent) {
        output += "\n";
      }

      output += "\n# warnings";
    }

    for (let index = 0; index < warnings.length; index += 1) {
      output +=
        index === 0 && !report.js && (report.cssModules?.length ?? 0) === 0
          ? `\n${warnings[index]}`
          : `\n\n${warnings[index]}`;
    }

    hasContent = true;
  }

  if (!hasContent) {
    return '""';
  }

  return `${output}\n"`;
}

expect.addSnapshotSerializer({
  test(value) {
    return value instanceof CsslitSnapshotReport;
  },
  serialize(value) {
    return renderSnapshotReport(value as CsslitSnapshotReport);
  },
});

type VirtualFiles = Record<`/${string}`, string>;

type HarnessCase = {
  entry: `/${string}`;
  files: VirtualFiles;
  root?: `/${string}`;
  workspaceRooted?: boolean;
};

type MapSummary = {
  file: string | null;
  mappingsPreview: string | null;
  namesCount: number;
  sourceRoot: string | null;
  sources: string[];
} | null;

type CssModuleSnapshot = {
  css: string;
  exports: Record<string, string>;
  id: string;
};

type CapturedWarningLocation = {
  column?: number;
  endColumn?: number;
  endLine?: number;
  file?: string;
  line?: number;
};

type CapturedWarning = {
  frame?: string;
  hook?: string;
  id?: string;
  loc?: CapturedWarningLocation;
  message: string;
  plugin: string;
};

type TransformedCssModule = {
  code: string;
  id: string;
  map: MapSummary;
  publicId: string;
};

type CsslitCaseResult = {
  entry: `/${string}`;
  files: VirtualFiles;
  runtime: {
    code: string;
    cssModuleIds: string[];
    id: string;
    map: MapSummary;
  };
  warnings: CapturedWarning[];
  writtenFiles: TransformedCssModule[];
};

type NormalizedMapInput = {
  file?: string | null;
  mappings?: string;
  names?: string[];
  sourceRoot?: string | null;
  sources?: string[];
} | null;

type CapturedWarningInput =
  | string
  | {
      frame?: string;
      hook?: string;
      id?: string;
      loc?: CapturedWarningLocation;
      message?: string;
      plugin?: string;
    };

type LoadContext = {
  warn: (warning: CapturedWarningInput) => void;
};

type CsslitPlugin = {
  load?: unknown;
  name: string;
} & Record<string, unknown>;

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

function normalizeWarningLocation(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const location = value as CapturedWarningLocation;
  return {
    column: typeof location.column === "number" ? location.column : undefined,
    endColumn: typeof location.endColumn === "number" ? location.endColumn : undefined,
    endLine: typeof location.endLine === "number" ? location.endLine : undefined,
    file: typeof location.file === "string" ? location.file : undefined,
    line: typeof location.line === "number" ? location.line : undefined,
  };
}

function sanitizeWarningFrame(frame: string) {
  return frame.replaceAll("\\", "/").replaceAll("`", "'").replaceAll("${", "#{");
}

function formatWarningMessage(rawWarning: Exclude<CapturedWarningInput, string>) {
  if (typeof rawWarning.message === "string") {
    return rawWarning.message;
  }

  return JSON.stringify(rawWarning);
}

function normalizeCapturedWarning(
  rawWarning: CapturedWarningInput,
  pluginName: string,
): CapturedWarning {
  if (typeof rawWarning === "string") {
    return {
      message: rawWarning,
      plugin: pluginName,
    };
  }

  return {
    frame:
      typeof rawWarning.frame === "string" ? sanitizeWarningFrame(rawWarning.frame) : undefined,
    hook: typeof rawWarning.hook === "string" ? rawWarning.hook : undefined,
    id: typeof rawWarning.id === "string" ? rawWarning.id : undefined,
    loc: normalizeWarningLocation(rawWarning.loc),
    message: formatWarningMessage(rawWarning),
    plugin: typeof rawWarning.plugin === "string" ? rawWarning.plugin : pluginName,
  };
}

function wrapCsslitPluginWithWarningCapture(plugin: CsslitPlugin, warnings: CapturedWarning[]) {
  const loadHook = plugin.load;
  if (typeof loadHook !== "object" || loadHook === null || !("handler" in loadHook)) {
    return plugin;
  }

  const loadHandler = loadHook.handler;
  if (typeof loadHandler !== "function") {
    return plugin;
  }

  return {
    ...plugin,
    load: {
      ...loadHook,
      async handler(this: LoadContext, ...args: unknown[]) {
        const originalWarn = this.warn;
        this.warn = (warning) => {
          warnings.push(normalizeCapturedWarning(warning, plugin.name));
        };

        try {
          return await loadHandler.apply(this, args);
        } finally {
          this.warn = originalWarn;
        }
      },
    },
  };
}

function summarizeMap(map: NormalizedMapInput): MapSummary {
  if (!map) {
    return null;
  }

  return {
    file: map.file ?? null,
    mappingsPreview: typeof map.mappings === "string" ? map.mappings.slice(0, 160) : null,
    namesCount: map.names?.length ?? 0,
    sourceRoot: map.sourceRoot ?? null,
    sources: map.sources ?? [],
  };
}

function stripSourceMapComment(code: string) {
  return code
    .replace(/\n\/\*# sourceMappingURL=[\s\S]*?\*\/\s*$/u, "")
    .replace(/\n\/\/[#@] sourceMappingURL=.*$/gmu, "")
    .replace(/\r\n?/g, "\n");
}

function extractVirtualCssIds(code: string) {
  return [...new Set(code.match(/(?:\/|[A-Za-z]:\/)[^"'`]+?\.csslit\.module\.css/g) ?? [])].map(
    normalizePath,
  );
}

function unwrapPublicId(id: string) {
  return id.startsWith("/@id/") ? normalizePath(decodeURIComponent(id.slice(5))) : id;
}

function normalizeSnapshotString(value: string, root: string) {
  let normalized = value.replace(/\r\n?/g, "\n");

  for (const absoluteRoot of [normalizePath(root), REPO_ROOT]) {
    const windowsRoot = absoluteRoot.replace(/\//g, "\\");
    const encodedRoot = encodeURIComponent(absoluteRoot);
    const encodedWindowsRoot = encodeURIComponent(windowsRoot);

    normalized = normalized
      .replaceAll(encodedWindowsRoot, encodeURIComponent(ROOT_TOKEN))
      .replaceAll(encodedRoot, encodeURIComponent(ROOT_TOKEN))
      .replaceAll(windowsRoot, ROOT_TOKEN)
      .replaceAll(absoluteRoot, ROOT_TOKEN);
  }

  return normalized;
}

function normalizeForSnapshot(value: unknown, root: string): unknown {
  if (typeof value === "string") {
    return normalizeSnapshotString(value, root);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForSnapshot(entry, root));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        normalizeSnapshotString(key, root),
        normalizeForSnapshot(entry, root),
      ]),
    );
  }

  return value;
}

let runCsslitCaseQueue: Promise<unknown> = Promise.resolve();

async function runCsslitCaseIsolated(input: HarnessCase): Promise<CsslitCaseResult> {
  const fileRoot = input.workspaceRooted ? TESTS_ROOT : SYNTHETIC_ROOT;
  const files = normalizeInputFiles(input.files);
  const absoluteFiles = absolutizeFiles(files, fileRoot);
  const entryId = absolutizeFile(input.entry, fileRoot);
  const serverRoot = input.root ? absolutizeFile(input.root) : TESTS_ROOT;
  const warnings: CapturedWarning[] = [];
  const restoreReadFile = installReadFileMock(absoluteFiles);

  try {
    const server = await createServer({
      appType: "custom",
      css: {
        devSourcemap: true,
      },
      dev: {
        sourcemap: {
          js: true,
        },
      },
      logLevel: "silent",
      plugins: [
        virtualFilesPlugin(absoluteFiles),
        wrapCsslitPluginWithWarningCapture(cssCompilePlugin() as CsslitPlugin, warnings),
      ],
      root: serverRoot,
      server: {
        middlewareMode: true,
      },
    });

    try {
      const runtimeResult = await server.transformRequest(entryId);
      if (!runtimeResult) {
        throw new Error(`No transform result for ${entryId}`);
      }

      const cssModuleIds = extractVirtualCssIds(runtimeResult.code);
      const cssModules: TransformedCssModule[] = [];

      for (const publicId of cssModuleIds) {
        const resolvedId = unwrapPublicId(publicId);
        const cssResult = await server.transformRequest(resolvedId);
        cssModules.push({
          code: cssResult?.code ?? "",
          id: resolvedId,
          map: summarizeMap(cssResult?.map as NormalizedMapInput),
          publicId,
        });
      }

      return normalizeForSnapshot(
        {
          entry: input.entry,
          files,
          runtime: {
            code: stripSourceMapComment(runtimeResult.code),
            cssModuleIds,
            id: entryId,
            map: summarizeMap(runtimeResult.map as NormalizedMapInput),
          },
          warnings,
          writtenFiles: cssModules,
        },
        SYNTHETIC_ROOT,
      ) as CsslitCaseResult;
    } finally {
      await server.close();
    }
  } finally {
    restoreReadFile();
  }
}

function compactSnapshotPath(value: string) {
  return value
    .replace(/\/[@]id\/<root>(\/[^\s"'`)]+?\.csslit\.module\.css)/g, "$1")
    .replace(/<root>(\/[^\s"'`)]+?\.csslit\.module\.css)/g, "$1");
}

function parseCssModuleSnapshot(code: string, id: string): CssModuleSnapshot {
  const cssLiteral = code.match(/const __vite__css = ("(?:\\.|[^"\\])*")/u)?.[1];
  const exportMatches = [
    ...code.matchAll(/export const\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*");/gu),
  ];

  if (!cssLiteral) {
    throw new Error(`Expected Vite CSS module wrapper for ${id}`);
  }

  return {
    css: JSON.parse(cssLiteral) as string,
    exports: Object.fromEntries(
      exportMatches.map(([, name, value]) => [name, JSON.parse(value) as string]),
    ),
    id: compactSnapshotPath(id),
  };
}

function formatSnapshotCode(code: string) {
  return code.replace(/\r\n?/g, "\n");
}

function stripCssSourceMapComment(css: string) {
  return css.replace(/\n?\/\*# sourceMappingURL=[\s\S]*?\*\/\s*$/u, "");
}

function formatSnapshotCss(css: string) {
  return stripCssSourceMapComment(css).replace(/\r\n?/g, "\n");
}

function formatCssModuleSnapshot(module: CssModuleSnapshot) {
  const exports = Object.keys(module.exports).length > 0 ? module.exports : undefined;

  return {
    css: formatSnapshotCss(module.css),
    exports,
    id: module.id,
  } satisfies SnapshotCssModule;
}

function padLines(value: string, count = 2) {
  const indentation = " ".repeat(count);

  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `${indentation}${line}`))
    .join("\n");
}

function formatCapturedWarning(warning: CapturedWarning) {
  const lines = [`warning: ${warning.message}`];

  if (warning.plugin) {
    lines.push(`  Plugin: ${warning.plugin}`);
  }

  if (warning.id) {
    const location =
      typeof warning.loc?.line === "number" && typeof warning.loc?.column === "number"
        ? `:${warning.loc.line}:${warning.loc.column}`
        : "";

    lines.push(`  File: ${warning.id}${location}`);
  }

  if (warning.frame) {
    lines.push(padLines(warning.frame));
  }

  return lines.join("\n");
}

export async function runCsslitCase(input: HarnessCase) {
  const currentRun = runCsslitCaseQueue.then(() => runCsslitCaseIsolated(input));
  runCsslitCaseQueue = currentRun.catch(() => {});
  return currentRun;
}

export async function snapshotCsslitCase(input: HarnessCase) {
  const result = await runCsslitCase(input);
  const cssModules = result.writtenFiles.map(({ code, id }) => parseCssModuleSnapshot(code, id));
  return createSnapshotReport({
    cssModules:
      cssModules.length > 0
        ? cssModules.map((module) => formatCssModuleSnapshot(module))
        : undefined,
    js: formatSnapshotCode(result.runtime.code),
    warnings:
      result.warnings.length > 0
        ? result.warnings.map((warning) => formatCapturedWarning(warning))
        : undefined,
  });
}

export async function snapshotCsslitWarningsCase(input: HarnessCase) {
  const result = await runCsslitCase(input);
  return createSnapshotReport({
    warnings:
      result.warnings.length > 0
        ? result.warnings.map((warning) => formatCapturedWarning(warning))
        : undefined,
  });
}

// Vite's dev-only import analysis plugin rewrites resolved imports to runnable
// URLs before the module runner evaluates transformed code. The comptime build
// runner uses the same execution model, but that dev plugin is not present in
// build mode, so csslit needs this narrow reimplementation. Keep this logic as
// close as possible to Vite's built-in import normalization behavior; it should
// only replace the URL rewrite we need, not HMR or module graph bookkeeping.
import { init as initLexer, parse } from "es-module-lexer";
import { existsSync } from "node:fs";
import { normalizePath } from "vite-plus";
import type { PluginOption } from "vite-plus";

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const viteIdPrefix = "/@id/";
const viteNullBytePlaceholder = "__x00__";
const viteFsPrefix = "/@fs/";
const skipRE = /\.(?:map|json)(?:$|\?)/;
const cssLangsRE = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const directRequestRE = /(?:\?|&)direct=?(?:&|$)/;

function cleanUrl(url: string) {
  return url.replace(/[?#].*$/u, "");
}

function isExternalUrl(url: string) {
  return /^[A-Za-z][A-Za-z\d+\-.]*:\/\//u.test(url) || url.startsWith("//");
}

function canSkipImportAnalysis(id: string) {
  return skipRE.test(id) || (cssLangsRE.test(id) && directRequestRE.test(id));
}

function normalizeResolvedIdToRunnableUrl(id: string, root: string) {
  const normalizedId = normalizePath(id);
  const normalizedRoot = normalizePath(root);

  let url: string;
  if (normalizedId.startsWith(`${normalizedRoot}/`)) {
    url = normalizedId.slice(normalizedRoot.length);
  } else if (
    (/^[A-Za-z]:\//u.test(normalizedId) || normalizedId.startsWith("/")) &&
    existsSync(cleanUrl(normalizedId))
  ) {
    url = `${viteFsPrefix}${normalizedId}`;
  } else {
    url = normalizedId;
  }

  if (url[0] !== "." && url[0] !== "/") {
    url = `${viteIdPrefix}${normalizedId.replace("\0", viteNullBytePlaceholder)}`;
  }

  return url;
}

export function csslitComptimeBuildImportNormalizer(): PluginOption {
  return {
    name: "vite-plugin-csslit-comptime-build-import-normalizer",
    enforce: "post",

    applyToEnvironment(environment) {
      return environment.name === "comptime" && environment.config.command === "build";
    },

    async transform(code, id) {
      if (canSkipImportAnalysis(id)) {
        return null;
      }

      // This is the small import-specifier rewrite that csslit needs from Vite's
      // built-in dev-only import analysis plugin. The full plugin also owns HMR
      // and module graph bookkeeping, but the comptime build runner only needs
      // resolved runnable URLs before evaluating transformed modules.
      await initLexer;
      const [imports] = parse(code, id);
      const replacements: Replacement[] = [];

      for (const importSpecifier of imports) {
        const specifier = importSpecifier.n;

        if (!specifier || importSpecifier.d === -2 || specifier.startsWith("data:")) {
          continue;
        }

        const resolved = await this.resolve(specifier, id);
        if (
          !resolved ||
          resolved.external ||
          ((resolved.meta as Record<string, { noResolved?: boolean }> | undefined)?.["vite:alias"]
            ?.noResolved ??
            false)
        ) {
          continue;
        }

        const resolvedId = isExternalUrl(resolved.id)
          ? resolved.id
          : normalizeResolvedIdToRunnableUrl(resolved.id, this.environment.config.root);
        if (resolvedId === specifier) {
          continue;
        }

        const isDynamicImport = importSpecifier.d > -1;
        replacements.push({
          end: isDynamicImport ? importSpecifier.e : importSpecifier.e + 1,
          start: isDynamicImport ? importSpecifier.s : importSpecifier.s - 1,
          text: JSON.stringify(resolvedId),
        });
      }

      if (replacements.length === 0) {
        return null;
      }

      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end);
      }

      return {
        code: code,
        map: null,
      };
    },
  };
}

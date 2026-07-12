function cssTag(_strings: TemplateStringsArray, ..._values: unknown[]): string {
  throw new Error(
    "csslit: The `css` template tag was executed at runtime! " +
      "This means the `@csslit/vite-plugin` is missing from your Vite configuration or failed to parse this file. " +
      "Please ensure the plugin is added to your vite.config.ts plugins array.",
  );
}

function globalCssTag(_strings: TemplateStringsArray, ..._values: unknown[]): void {
  throw new Error(
    "csslit: The `css.global` template tag was executed at runtime! " +
      "This means the `@csslit/vite-plugin` is missing from your Vite configuration or failed to parse this file. " +
      "Please ensure the plugin is added to your vite.config.ts plugins array.",
  );
}

export type CssTag = ((_strings: TemplateStringsArray, ..._values: unknown[]) => string) & {
  global: (_strings: TemplateStringsArray, ..._values: unknown[]) => void;
};

/**
 * A compile-time CSS template literal tag.
 * The `csslit` Vite plugin intercepts this tag and statically extracts the styling at build time.
 */
export const css: CssTag = Object.assign(cssTag, {
  global: globalCssTag,
});

export function comptime<T>(value: T): T {
  return value;
}

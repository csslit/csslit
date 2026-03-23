/**
 * A compile-time CSS template literal tag.
 * The `csslit` Vite plugin intercepts this tag and statically extracts the styling at build time.
 */
export function css(_strings: TemplateStringsArray, ..._values: unknown[]): string {
  throw new Error(
    "csslit: The `css` template tag was executed at runtime! " +
      "This means the `@csslit/vite-plugin` is missing from your Vite configuration or failed to parse this file. " +
      "Please ensure the plugin is added to your vite.config.ts plugins array.",
  );
}

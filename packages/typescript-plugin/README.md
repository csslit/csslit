# @csslit/typescript-plugin

A TypeScript server plugin used by the
**[csslit VS Code extension](https://marketplace.visualstudio.com/items?itemName=csslit.csslit-vscode)**
to locate csslit `css` / `css.global` template literals.

## When you need it

Install this package for the csslit VS Code extension to handle `.tsrx`, `.vue`, `.svelte`,
`.astro`, `.mdx`, and similar files. Add it to your `tsconfig.json`, listed **before** that file
type's own TypeScript plugin, so csslit runs closest to the language service and the other plugin
maps its results back to accurate locations in your file:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csslit/typescript-plugin" }, { "name": "@tsrx/typescript-plugin" }],
  },
}
```

Use the workspace TypeScript version (the classic `tsserver`); framework mapping is not available
under TypeScript Native Preview.

See the [csslit project README](https://github.com/csslit/csslit#readme) for the full setup.

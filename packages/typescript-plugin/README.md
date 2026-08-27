# @csslit/typescript-plugin

A TypeScript server plugin used by the
**[csslit VS Code extension](https://marketplace.visualstudio.com/items?itemName=csslit.csslit-vscode)**
to locate csslit `css` / `css.global` template literals.

## When you need it

Install this package for the csslit VS Code extension to handle `.tsrx`, `.vue`, and `.mdx` files.
Add it to your `tsconfig.json`, listed **before** that language's own TypeScript plugin, so csslit
runs closest to the language service and the other plugin maps its results back to accurate
locations in your file:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csslit/typescript-plugin" }, { "name": "@tsrx/typescript-plugin" }],
  },
}
```

`.js`, `.jsx`, `.ts`, and `.tsx` files do not need this extra project setup, so React, Solid, Vue
JSX, Angular, and other frameworks work out of the box.

Use the workspace TypeScript version (the classic `tsserver`); mapped-language support is not
available under TypeScript Native Preview.

See the [csslit project README](https://github.com/csslit/csslit#readme) for the full setup.

# csslit for VS Code

CSS syntax highlighting, completions, and hovers inside csslit tagged template literals.

```tsx
import { css } from "csslit";

const button = css`
  color: white;
  background: rebeccapurple;

  &:hover {
    background: indigo;
  }
`;

css.global`
  body {
    margin: 0;
  }
`;
```

Highlighting works in JavaScript, JSX, TypeScript, TSX, HTML scripts, Angular, Astro, Marko, MDX,
Svelte, Vue, and TSRX.

Completions and hovers work automatically in JavaScript and TypeScript. For **framework files**
(Ripple, Vue, Svelte, Astro, MDX), install [`@csslit/typescript-plugin`](https://www.npmjs.com/package/@csslit/typescript-plugin)
and add it to your `tsconfig.json` `plugins`, listed before the framework's own TypeScript plugin:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csslit/typescript-plugin" }, { "name": "@tsrx/typescript-plugin" }],
  },
}
```

Use the workspace TypeScript version; while TypeScript Native Preview is enabled, completions and
hovers are available only in JavaScript and TypeScript.

Source and issues: [github.com/csslit/csslit](https://github.com/csslit/csslit)

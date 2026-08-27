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

Highlighting works in `.js`, `.jsx`, `.ts`, `.tsx`, `.html`, `.astro`, `.marko`, `.mdx`, `.svelte`,
`.vue`, and `.tsrx` files.

Completions and hovers work automatically in `.js`, `.jsx`, `.ts`, and `.tsx` files. React, Solid,
Vue JSX, Angular, and other frameworks work without additional csslit setup.

For `.tsrx`, `.vue`, and `.mdx` files, install
[`@csslit/typescript-plugin`](https://www.npmjs.com/package/@csslit/typescript-plugin) and add it to
your `tsconfig.json` `plugins`:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csslit/typescript-plugin" }],
  },
}
```

If the language's own setup also lists a TypeScript plugin there, `@csslit/typescript-plugin` must
come first.

Use the workspace TypeScript version; while TypeScript Native Preview is enabled, completions and
hovers are available only in `.js`, `.jsx`, `.ts`, and `.tsx` files.

Source and issues: [github.com/csslit/csslit](https://github.com/csslit/csslit)

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
Svelte, Vue, and TSRX. Completions and hovers currently work in JavaScript and TypeScript files and require the
[TypeScript 7 extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)
with TypeScript 7 enabled through **TypeScript: Enable TypeScript 7**.

Source and issues: [github.com/csslit/csslit](https://github.com/csslit/csslit)

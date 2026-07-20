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
Svelte, Vue, and TSRX. Completions and hovers work in JavaScript, TypeScript, and TSRX files.

Source and issues: [github.com/csslit/csslit](https://github.com/csslit/csslit)

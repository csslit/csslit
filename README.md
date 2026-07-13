# csslit

Compile-time CSS template literals for Vite. csslit evaluates interpolations during development and builds, emits static CSS, and leaves ordinary class names in application code.

> csslit is preparing for its first public release. The API and documentation are still evolving.

## Requirements

- Node.js 24.11 or newer
- Vite 8.1 or newer

## Install

```sh
npm install @csslit/core @csslit/vite-plugin
```

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { csslitPlugin } from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [csslitPlugin()],
});
```

## Use csslit

```ts
import { css } from "@csslit/core";

const accent = "rebeccapurple";

const className = css`
  color: ${accent};
  font-weight: 600;
`;

css.global`
  body {
    margin: 0;
  }
`;
```

The plugin evaluates supported interpolation code at compile time and extracts the result into static CSS. The `css` package itself does not ship a client-side styling runtime.

## Status

The initial release targets native Windows x64 and Linux x64 builds, with a WebAssembly/WASI fallback planned for environments such as StackBlitz WebContainers.

## License

[MIT](./LICENSE)

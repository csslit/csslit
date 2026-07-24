# @csslit/vite-plugin

The Vite plugin for compile-time csslit styles.

```ts
import { defineConfig } from "vite";
import csslit from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [csslit()],
});
```

For files lowered to JavaScript or TypeScript by another Vite plugin, map their
extension to the parser source type csslit should use:

```ts
csslit({ moduleType: { ".tsrx": "tsx" } });
```

The built-in mappings for `.js`, `.jsx`, `.ts`, and `.tsx` are used by default.

See the [project README](https://github.com/csslit/csslit#readme) for installation and usage.

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
import csslit from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [csslit()],
});
```

## Getting started

Import `css` and write declarations in a template literal. The result is an ordinary class name string:

```tsx
import { css } from "@csslit/core";

const button = css`
  padding: 0.6rem 1rem;
  color: white;
  background: rebeccapurple;
  border: 0;
  border-radius: 0.4rem;
  font-weight: 600;

  &:hover {
    background: indigo;
  }
`;

export function SaveButton() {
  return <button className={button}>Save</button>;
}
```

The Vite plugin replaces the template with a generated class name and emits the styles as static CSS. There is no styling runtime in the browser.

The same class string can be used anywhere that accepts a class name; csslit is not tied to React.

### Interpolate build-time values

Interpolations are real JavaScript expressions evaluated while Vite builds your application:

```ts
import { css } from "@csslit/core";
import { tokens } from "./tokens";

const borderWidth = 2;
const px = (value: number) => `${value}px`;

export const panel = css`
  padding: ${px(16)};
  color: ${tokens.text};
  border: ${borderWidth}px solid ${tokens.border};
`;
```

Constants, imported values, property access, function calls, conditions, arrays, objects, and closures can all be useful inside an interpolation. The final value is inserted into the CSS before it is compiled.

### Compose scoped classes

You can interpolate one csslit class into another selector:

```ts
const card = css`
  padding: 1rem;
`;

const title = css`
  .${card} & {
    margin-block: 0 0.5rem;
  }
`;
```

Both class names remain scoped, including when the classes are imported from different modules.

### Add global CSS

Use `css.global` for rules that should not receive a generated class:

```ts
css.global`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: system-ui, sans-serif;
  }
`;
```

`css.global` emits CSS for its side effect and does not return a class name. Global and scoped blocks keep their source order.

## Core rules

The simplest mental model is that csslit runs the code needed by each CSS template in a fresh build-time environment. Your application is not running, and the evaluation should not change shared state.

### CSS is decided at build time

An interpolation cannot depend on a component prop, browser API, event, or other value that only exists while the application runs. A CSS template inside a function is still one static CSS block; it does not become a runtime style factory:

```ts
function colorClass(color: string) {
  // This cannot produce a new class for every runtime value of `color`.
  return css`
    color: ${color};
  `;
}
```

For runtime variation, choose between static classes in application code or pass the changing value through a CSS custom property or inline style.

### Bindings used by CSS must be stable

A binding used by CSS must retain one value. Primitive constants and expressions built from other stable values work naturally:

```ts
const accent = "rebeccapurple";
const border = `1px solid ${accent}`;

const panel = css`
  color: ${accent};
  border: ${border};
`;
```

Reassigning `accent` later would make it unavailable to CSS. csslit also treats objects and functions used by CSS as stable: they must not contain state that changes after they are produced.

Temporary values can still be created and consumed directly inside an interpolation. For example, this array never becomes shared state:

```ts
const fading = css`
  transition: ${["opacity 0.2s", "visibility 0.2s"].join(", ")};
`;
```

### Use `comptime` to assert stability

csslit cannot know whether a newly created object or a function's return value will contain changing state when that value is stored for later use. Use `comptime(...)` in the binding initializer to assert that it is stable:

```ts
import { comptime, css } from "@csslit/core";

const theme = comptime(createTheme());

const panel = css`
  color: ${theme.text};
  background: ${theme.background};
`;
```

The same applies to locally created arrays, objects, constructed instances, and tagged-template results:

```ts
const tokens = comptime({
  spacing: [4, 8, 16],
  accent: "rebeccapurple",
});
```

`comptime(...)` is an assertion, not a conversion. It does not freeze the value or make stateful code safe. You are promising that the result will not change through methods, aliases, closures, `Object.assign`, or similar mechanisms.

### Imported values are trusted

Imported values are assumed to follow the same stability rule. This keeps normal module APIs convenient and avoids whole-program analysis:

```ts
import { theme, selectTone } from "./theme";

const panel = css`
  color: ${selectTone(theme)};
`;
```

csslit does not inspect other modules to prove that their exports are stable, so keeping that promise is the module author's responsibility.

### Evaluation does not mutate objects or captured state

Code evaluated for CSS may read stable values, but it cannot assign to object properties, delete properties, or update a binding outside the current closure.

Closures may use parameters and local variables for contained calculations. They may also read captured stable values, but may not modify captures. A nested closure therefore cannot modify a local belonging to its enclosing closure.

This makes short local calculations possible while keeping their effects contained:

```ts
import { sizes } from "./tokens";

const grid = css`
  width: ${(() => {
    let total = 0;
    for (const size of sizes) total += size;
    return total;
  })()}px;
`;
```

Prefer immutable construction with object and array spreads, `map`, or `Object.fromEntries` over building a value and mutating it afterward.

### Every CSS template is independent

Each `css` or `css.global` template is evaluated on its own. A nested template does not wait for an enclosing callback to run, so its interpolations cannot use that callback's parameters or locals:

```ts
// This does not create one CSS class for every color.
colors.map(
  (color) => css`
    color: ${color};
  `,
);
```

Create the finite set of static classes explicitly, or use a custom property when the value is truly dynamic.

### Language boundaries

Evaluation is synchronous. Use static imports; direct `await`, `yield`, and dynamic `import()` cannot provide interpolation values.

Classes, private fields, and `super` are not evaluated from local source. If a library exposes an API involving these features, put it in another module and import the stable value or function you need.

TypeScript annotations are supported and removed for evaluation. Local TypeScript enums and namespaces are not evaluated; ordinary imported runtime values are the simpler alternative.

If evaluation throws, csslit reports the interpolation, the relevant binding chain, and the original source location during development or build.

## Status

The initial release targets native Windows x64 and Linux x64 builds, with a WebAssembly/WASI fallback planned for environments such as StackBlitz WebContainers.

## License

[MIT](./LICENSE)

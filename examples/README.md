# Examples

These minimal TypeScript applications exercise csslit through the framework's normal Vite build:

- [React](./react)
- [Preact](./preact)
- [Solid](./solid)
- [Vue](./vue)
- [Octane](./octane)
- [React Router Framework Mode](./react-router)

Run an example from the repository root:

```sh
npm run dev --workspace=example-react
npm run build --workspace=example-react
```

Replace `react` with `preact`, `solid`, `vue`, `octane`, or `react-router`. `vp run -w check`
type-checks the TypeScript examples where the framework exposes a TypeScript checker and builds all
six production applications.

## Compatibility notes

- The Vue example keeps TypeScript 6 local to its `vue-tsc` process because the current Vue checker
  does not yet run against TypeScript 7 internals.
- The Octane example pins 0.1.19, matching csslit's tested TSRX integration, and keeps TypeScript
  5.9 local to the example because `@tsrx/typescript-plugin` declares a TypeScript 5.9 peer.

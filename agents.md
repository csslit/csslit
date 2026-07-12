# Agent Notes

## `vp` CLI

Unified toolchain from voidzero combining vite, vitest, oxcfmt, oxclint and a atask runnner in one command.

- `vp` is available in PATH.
- Use `vite-plus` as the primary import source for anything normally imported from `vite` or `vitest`.
- `vp run -w build` - Rebuild all packages.
- `vp run -w test` - Run all tests.
- `vp run <package>#<task>` - Run specific task.
- `run` is required to run tasks. Omitting it means you are using a vite-plus builtin command instead of the config defined tasks.
- vite.config.ts contains workspace and per project configuration
- `vp run playground#dev` - Run the playground dev server. This will automatically rebuild all packages it depends on. Remember to stop the dev server once you are done using it.

Run tasks have `dependsOn` specified to build dependencies first. For tests, use `vp run tests#test` (or `vp run -w test`) so dirty Rust/NAPI and package artifacts are rebuilt. Running `vp test` directly bypasses the task graph and can test against stale `dist/` artifacts. Pass test-runner arguments after the task, for example `vp run tests#test -- -u` to update snapshots.

For routine changes, use `vp run -w check` as the single cached verification command for formatting, linting, compilation, and integration tests. The task graph caches clean dependencies, so the cold path may rebuild NAPI but warm checks should be reasonable. Use the full `vp run tests#test` pipeline when you need detailed test output or snapshot updates. Keep tool output limits small for successful checks and request full output only when a command fails.

## Build Artifacts

- Build artifacts are generally stored in `dist/` folders across all packages.

- Use `.agents/` directory (at the workspace root or within any package) for all scratch files, logs, and temporary debugging scripts.
- Never create scratch files (like `build-log.txt` or `debug-helper.js`) directly in the project folders unless they are prefixed with `.agents/`.
- This directory is git-ignored and ensures the repository stays clean for commits.

> [!IMPORTANT]
> Build commands (`vp run build`, `napi build`) may fail if there are active dev servers running due to file locks or port conflicts. If a build fails unexpectedly or a new dev server starts with a port other than 5173, check for running dev servers and ask the user to stop them if necessary.

## Code Style

- Prefer trusting established contracts between Vite/plugins/tooling instead of adding defensive fallback code for cases that should not happen. If another layer violates the contract, prefer surfacing it clearly and fixing or reporting it there.
- Prefer straight-line code over abstractions unless there is a substantial piece of code reuse. Avoid introducing helpers or indirection for small one-off logic.
- Start from the actual guarantees of the data produced by this project and solve that concrete problem. Do not generalize into a reusable or defensive implementation for hypothetical inputs unless the real contract requires it.

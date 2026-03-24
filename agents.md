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

run tasks have dependsOn specified to build dependencies to the task first.

## Build Artifacts

- Build artifacts are generally stored in `dist/` folders across all packages.

- Use `.agents/` directory (at the workspace root or within any package) for all scratch files, logs, and temporary debugging scripts.
- Never create scratch files (like `build-log.txt` or `debug-helper.js`) directly in the project folders unless they are prefixed with `.agents/`.
- This directory is git-ignored and ensures the repository stays clean for commits.

> [!IMPORTANT]
> Build commands (`vp run build`, `napi build`) may fail if there are active dev servers running due to file locks or port conflicts. If a build fails unexpectedly or a new dev server starts with a port other than 5173, check for running dev servers and ask the user to stop them if necessary.

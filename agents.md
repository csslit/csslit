# Agent Notes

## `vp` CLI

Unified toolchain from voidzero combining vite, vitest, oxcfmt, oxclint and a atask runnner in one command.

- `vp` is available in PATH.
- `vp run -w build` - Rebuild all packages.
- `vp run -w test` - Run all tests.
- `vp run <package>#<task>` - Run specific task.
- vite.config.ts contains workspace and per project configuration

run tasks have dependsOn specified to build dependencies to the task first.

## Build Artifacts

- Build artifacts are generally stored in `dist/` folders across all packages.

## Scratch Files

- Use `.agents/` directory for all scratch files, logs, and temporary debugging scripts.

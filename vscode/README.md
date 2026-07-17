# csslit for VS Code

A minimal VS Code extension that contributes the `csslit: Hello World` command.

## Development

1. Open the monorepo root in VS Code.
2. Select `Run Extension` and press `F5` to build the extension and open an Extension Development Host.
3. Run `csslit: Hello World` from the Command Palette.

Run `vp run build` for a development build, `vp run dev` to watch for changes, or `vp run package` for a minified production build.

## Release

After installing the workspace dependencies, run `vp run release` from this directory. It removes previous build and VSIX artifacts, bundles the extension, then creates `dist/csslit-vscode.vsix` ready to publish to the VS Code Marketplace.

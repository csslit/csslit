import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serveWebTargets } from "../src/testing/frameworks.ts";
import type { Framework } from "../src/testing/frameworks.ts";

const fixtureRoot = join(import.meta.dirname, "..", "fixtures", "serve-web");
const manifestPath = join(fixtureRoot, "fixture.json");

type Manifest = { node: string; main: string };

export function serverCommand(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

export const serveWebFixture = (framework: Framework) => {
  const root = join(fixtureRoot, framework.name);
  const workspaceDir = join(root, "workspace");
  return {
    dataDir: root,
    extensionsDir: join(root, "extensions"),
    workspaceDir,
    file: join(workspaceDir, `case${framework.fileExtension}`),
  };
};

export const browserProfile = join(fixtureRoot, "browser-profile");

const repoRoot = join(import.meta.dirname, "..", "..");
const extensionRoot = join(import.meta.dirname, "..");

function link(source: string, target: string, type: "file" | "dir"): void {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  symlinkSync(source, target, type);
}

async function resolveServer(): Promise<Manifest> {
  const root = join(homedir(), ".vscode", "cli", "serve-web");
  const asManifest = (commit: string): Manifest => ({
    node: join(root, commit, process.platform === "win32" ? "node.exe" : "node"),
    main: join(root, commit, "out", "server-main.js"),
  });
  const isReady = (commit: string) => existsSync(asManifest(commit).main);

  const existing = existsSync(root) ? readdirSync(root) : [];
  const found = existing.find(isReady);
  if (found) return asManifest(found);

  console.log("downloading the serve-web server (first run only)");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const tunnel = (process.env["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, `code-tunnel${suffix}`))
    .find(existsSync);
  if (!tunnel) {
    throw new Error("code-tunnel was not found on PATH");
  }
  const server = spawn(
    tunnel,
    ["serve-web", "--accept-server-license-terms", "--without-connection-token", "--port", "0"],
    { stdio: "ignore" },
  );
  try {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const ready = (existsSync(root) ? readdirSync(root) : []).find(isReady);
      if (ready) return asManifest(ready);
      await delay(500);
    }
  } finally {
    server.kill();
  }
  throw new Error("VS Code server download timed out");
}

if (import.meta.filename === process.argv[1]) {
  const server = await resolveServer();

  for (const { framework } of serveWebTargets) {
    const { extensionsDir, workspaceDir, file } = serveWebFixture(framework);
    mkdirSync(extensionsDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    rmSync(join(extensionsDir, "extensions.json"), { force: true });
    writeFileSync(
      join(workspaceDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            jsx: "preserve",
            module: "preserve",
            moduleResolution: "bundler",
            target: "esnext",
            types: [],
            skipLibCheck: true,
            plugins: framework.integration?.workspacePlugins,
          },
          include: ["**/*"],
        },
        undefined,
        2,
      )}\n`,
    );
    writeFileSync(file, framework.wrap("const a = css`color: red;`;"));
    const integration = framework.integration;
    if (integration) {
      const target = integration.installExtension;
      console.log(`installing ${target}`);
      const result = spawnSync(
        server.node,
        [server.main, "--extensions-dir", extensionsDir, "--install-extension", target, "--force"],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        throw new Error(`Installing ${target} failed: ${result.stderr ?? result.stdout}`);
      }
    }

    const csslit = join(extensionsDir, "csslit-vscode");
    link(join(extensionRoot, "package.json"), join(csslit, "package.json"), "file");
    link(join(extensionRoot, "dist"), join(csslit, "dist"), "dir");
    link(
      join(repoRoot, "node_modules", "@csslit", "typescript-plugin"),
      join(csslit, "node_modules", "@csslit", "typescript-plugin"),
      "dir",
    );

    const harness = join(extensionsDir, "csslit-harness");
    link(
      join(extensionRoot, "src", "testing", "vscode-harness.ts"),
      join(harness, "vscode-harness.ts"),
      "file",
    );
    writeFileSync(
      join(harness, "package.json"),
      `${JSON.stringify(
        {
          name: "csslit-harness",
          publisher: "csslit",
          version: "0.0.0",
          engines: { vscode: "^1.125.0" },
          type: "module",
          main: "./vscode-harness.ts",
          activationEvents: ["onStartupFinished"],
        },
        undefined,
        2,
      )}\n`,
    );

    const expectedExtensionId = integration?.installExtension.split("@")[0]?.toLowerCase();
    let expectedExtensionFound = expectedExtensionId === undefined;
    const entries = [];
    for (const extension of readdirSync(extensionsDir)) {
      const manifestPath = join(extensionsDir, extension, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        publisher: string;
        version: string;
      };
      const id = `${manifest.publisher}.${manifest.name}`;
      if (id.toLowerCase() === expectedExtensionId) expectedExtensionFound = true;
      const absolute = join(extensionsDir, extension).replaceAll("\\", "/");
      entries.push({
        identifier: { id },
        version: manifest.version,
        location: {
          path: absolute.startsWith("/") ? absolute : `/${absolute}`,
          scheme: "file",
        },
      });
    }
    if (!expectedExtensionFound) {
      throw new Error(`Installing ${integration!.installExtension} did not create an extension`);
    }
    writeFileSync(join(extensionsDir, "extensions.json"), JSON.stringify(entries, undefined, 2));
  }

  mkdirSync(fixtureRoot, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(server, undefined, 2)}\n`);
  console.log(`serve-web fixture ready at ${fixtureRoot}`);
}

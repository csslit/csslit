import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type tsserver from "typescript6/lib/tsserverlibrary";
import { parsedModuleFromEdits } from "../parsed-module.ts";
import type { ParsedModule } from "../types.ts";
import { buildVirtualCss } from "../virtual-css.ts";
import type { Framework } from "./frameworks.ts";
import { NoTypeScriptResponse } from "./locator.ts";
import type { TemplateLocator } from "./locator.ts";

const require = createRequire(import.meta.url);
const CSSLIT_PLUGIN = "@csslit/typescript-plugin";

type Response = tsserver.server.protocol.Response;
type TsServerEdit = tsserver.server.protocol.CodeEdit;

const DEFERRED_SCRIPT_KIND = 7;

export function createTsServerLocator(framework: Framework): TemplateLocator {
  const { name, fileExtension, integration, wrap } = framework;
  const root = join(import.meta.dirname, "..", "..", "fixtures", `tsserver-${name}`);
  const casePath = join(root, `case${fileExtension}`);
  const initialSource = wrap("const a = css`color: red;`;");

  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "preserve",
          module: "preserve",
          moduleResolution: "bundler",
          target: "esnext",
          types: [],
          skipLibCheck: true,
        },
        include: ["**/*"],
      },
      undefined,
      2,
    ),
  );
  writeFileSync(casePath, initialSource);
  const server = new Server(
    root,
    integration?.tsserverPlugin,
    fileExtension,
    casePath,
    initialSource,
  );

  return {
    async virtualCss(source, offset) {
      const module = await server.parse(source, offset);
      return module && buildVirtualCss(module, offset);
    },
    async [Symbol.asyncDispose]() {
      server.stop();
    },
  };
}

class Server {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, (response: Response) => void>();
  #buffer = Buffer.alloc(0);
  #source: string;
  #seq = 0;
  readonly #file: string;
  readonly #verifyFrameworkMapping: boolean;

  constructor(
    root: string,
    plugin: string | undefined,
    fileExtension: string,
    file: string,
    source: string,
  ) {
    this.#file = file;
    this.#source = source;
    this.#verifyFrameworkMapping = plugin !== undefined;
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    this.#process = spawn(
      process.execPath,
      [
        require.resolve("typescript6/lib/tsserver.js"),
        "--globalPlugins",
        plugin === undefined ? CSSLIT_PLUGIN : `${CSSLIT_PLUGIN},${plugin}`,
        "--pluginProbeLocations",
        [repoRoot, join(repoRoot, "vscode")].join(","),
      ],
      { cwd: root, stdio: "pipe" },
    );
    this.#process.stdout.on("data", (chunk: Buffer) => this.#receive(chunk));
    if (fileExtension !== ".tsx") {
      void this.#request("configure", {
        extraFileExtensions: [
          {
            extension: fileExtension,
            isMixedContent: false,
            scriptKind: DEFERRED_SCRIPT_KIND,
          },
        ],
      });
    }
    void this.#request("open", {
      file,
      fileContent: source,
      projectRootPath: root,
    });
  }

  stop(): void {
    this.#process.kill();
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.#buffer.toString("ascii", 0, headerEnd);
      const length = Number(/Content-Length: (\d+)/.exec(header)![1]);
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) return;
      const message = JSON.parse(
        this.#buffer.toString("utf8", bodyStart, bodyStart + length),
      ) as Response;
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      if (message.type === "response") {
        this.#pending.get(message.request_seq)!(message);
        this.#pending.delete(message.request_seq);
      }
    }
  }

  async #request(command: string, args: unknown): Promise<Response> {
    const seq = ++this.#seq;
    this.#process.stdin.write(
      `${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`,
    );
    const response = Promise.withResolvers<Response>();
    using _timeout = setTimeout(
      () => response.reject(new Error(`tsserver ${command} timed out`)),
      20_000,
    );
    this.#pending.set(seq, response.resolve);
    return await response.promise;
  }

  async parse(source: string, sourceOffset: number): Promise<ParsedModule | undefined> {
    if (source !== this.#source) {
      const previousLines = this.#source.split("\n");
      await this.#request("updateOpen", {
        changedFiles: [
          {
            fileName: this.#file,
            textChanges: [
              {
                start: { line: 1, offset: 1 },
                end: {
                  line: previousLines.length,
                  offset: previousLines.at(-1)!.length + 1,
                },
                newText: source,
              },
            ],
          },
        ],
      });
    }
    this.#source = source;

    const before = source.slice(0, sourceOffset);
    const line = before.split("\n").length;
    const offset = sourceOffset - (before.lastIndexOf("\n") + 1) + 1;
    const response = await this.#request("_csslit:findTemplates", {
      file: this.#file,
      line,
      offset,
      verifyFrameworkSource: this.#verifyFrameworkMapping ? source : undefined,
    });
    if (!response.success) throw new Error(String(response.message ?? "tsserver request failed"));
    const body = response.body as {
      answered: boolean;
      edits: { textChanges: TsServerEdit[] }[];
      frameworkMapped?: boolean;
    };
    if (this.#verifyFrameworkMapping && body.answered && body.frameworkMapped !== true) {
      throw new Error("Language integration did not map source");
    }
    if (!body.answered) throw new NoTypeScriptResponse();
    if (body.edits.length === 0) return;

    const lineStarts = [0];
    for (let index = 0; index < source.length; index++) {
      if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
    }
    const offsetAt = (position: { line: number; offset: number }) => {
      const line = Math.max(0, Math.min(position.line - 1, lineStarts.length - 1));
      const start = lineStarts[line]!;
      const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : source.length;
      return Math.min(start + Math.max(0, position.offset - 1), end);
    };
    return parsedModuleFromEdits(
      source,
      body.edits.flatMap(({ textChanges }) =>
        textChanges.map(({ start, end, newText }) => ({
          start: offsetAt(start),
          end: offsetAt(end),
          newText,
        })),
      ),
    );
  }
}

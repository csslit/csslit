import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { Framework } from "./frameworks.ts";
import type { HarnessInit, HarnessRequest, HarnessResponse } from "./vscode-harness.ts";
import { NoTypeScriptResponse } from "./locator.ts";
import type { TemplateLocator } from "./locator.ts";
import { browserProfile, serveWebFixture, serverCommand } from "../../scripts/serve-web-fixture.ts";

const PORT_BASE = Number(process.env["CSSLIT_SERVE_WEB_PORT_BASE"] ?? 9910);
const READINESS_TIMEOUT_MS = 10_000;

const WINDOWS_CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

type BrowserMessage = {
  error?: { message: string };
  result: Record<string, unknown>;
};

async function* readBrowserMessages(output: Socket): AsyncGenerator<BrowserMessage> {
  let buffered = Buffer.alloc(0);
  for await (const chunk of output) {
    buffered = Buffer.concat([buffered, chunk as Buffer]);
    let end;
    while ((end = buffered.indexOf(0)) !== -1) {
      yield JSON.parse(buffered.toString("utf8", 0, end)) as BrowserMessage;
      buffered = buffered.subarray(end + 1);
    }
  }
}

type Browser = {
  input: Socket;
  responses: AsyncIterator<BrowserMessage>;
};

function createBrowser(): Browser {
  mkdirSync(browserProfile, { recursive: true });
  const process_ = spawn(
    process.env["CSSLIT_CHROME"] ??
      (process.platform === "win32"
        ? WINDOWS_CHROME.find((path) => existsSync(path))
        : undefined) ??
      "chrome",
    [
      "--headless=new",
      "--remote-debugging-pipe",
      `--user-data-dir=${browserProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  process_.unref();
  const input = process_.stdio[3] as Socket;
  const output = process_.stdio[4] as Socket;
  input.unref();
  output.unref();
  return {
    input,
    responses: readBrowserMessages(output),
  };
}

let browser: Browser | undefined;
let browserRequestDone = Promise.resolve();

async function sendBrowserRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const previous = browserRequestDone;
  const completed = Promise.withResolvers<void>();
  browserRequestDone = completed.promise;
  await previous;
  try {
    browser ??= createBrowser();
    browser.input.write(
      `${JSON.stringify({
        id: 1,
        method,
        params,
      })}\0`,
    );
    const response = await browser.responses.next();
    if (response.done) throw new Error("browser debugger closed");
    if (response.value.error) throw new Error(response.value.error.message);
    return response.value.result;
  } finally {
    completed.resolve();
  }
}

async function createServeWebSession(framework: Framework) {
  const { dataDir, extensionsDir, workspaceDir, file } = serveWebFixture(framework);
  const { integration } = framework;
  const port = PORT_BASE + framework.serveWebPortOffset;

  await using resources = new AsyncDisposableStack();

  const harness = createServer();
  const connection = Promise.withResolvers<Socket>();
  harness.once("connection", connection.resolve);
  harness.listen(0, "127.0.0.1");
  await once(harness, "listening");
  resources.use(harness);
  const harnessPort = (harness.address() as { port: number }).port;

  const server = serverCommand();
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("VSCODE_")) env[name] = undefined;
  }
  env["CSSLIT_HARNESS_PORT"] = String(harnessPort);
  const code = spawn(
    server.node,
    [
      server.main,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--without-connection-token",
      "--accept-server-license-terms",
      "--disable-workspace-trust",
      "--enable-remote-auto-shutdown",
      "--remote-auto-shutdown-without-delay",
      "--server-data-dir",
      dataDir,
      "--extensions-dir",
      extensionsDir,
    ],
    {
      stdio: "ignore",
      env,
    },
  );
  code.unref();
  const codeClosed = once(code, "close");
  resources.use(code);

  const deadline = Date.now() + 60_000;
  let serving = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).status === 200) {
        serving = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await delay(100);
  }
  if (!serving) {
    throw new Error("VS Code server startup timed out");
  }

  const slashed = workspaceDir.replaceAll("\\", "/");
  const folder = slashed.startsWith("/") ? slashed : `/${slashed}`;
  const url = `http://127.0.0.1:${port}/?folder=${encodeURIComponent(folder)}`;
  const { targetId } = (await sendBrowserRequest("Target.createTarget", { url })) as {
    targetId: string;
  };
  resources.defer(async () => {
    await sendBrowserRequest("Target.closeTarget", { targetId });
  });

  const socket = await connection.promise;
  const readiness = Promise.withResolvers<void>();
  harness.once("connection", (signal) => {
    signal.destroy();
    readiness.resolve();
  });
  socket.once("close", () => readiness.reject(new Error("harness closed before readiness")));
  socket.on("error", readiness.reject);
  socket.write(
    `${JSON.stringify({
      ...integration?.harness,
      file: file.replaceAll("\\", "/"),
    } satisfies HarnessInit)}\n`,
  );
  {
    using _readinessTimeout = setTimeout(
      () => readiness.reject(new Error("TypeScript plugin readiness timed out")),
      READINESS_TIMEOUT_MS,
    );
    await readiness.promise;
  }
  return {
    socket,
    responses: createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator](),
    resources: resources.move(),
    codeClosed,
  };
}

export function createServeWebLocator(framework: Framework): TemplateLocator {
  const session = createServeWebSession(framework);

  return {
    async virtualCss(source, offset) {
      const { socket, responses } = await session;
      socket.write(
        `${JSON.stringify({
          source,
          offset,
        } satisfies HarnessRequest)}\n`,
      );
      const next = await responses.next();
      if (next.done) throw new Error("harness closed before responding");
      const response = JSON.parse(next.value) as HarnessResponse;
      if (typeof response === "string") throw new Error(response);
      if (!response.parsed) throw new NoTypeScriptResponse();
      return response.virtualCss ?? undefined;
    },
    async [Symbol.asyncDispose]() {
      const { socket, resources, codeClosed } = await session;
      socket.destroy();
      await resources.disposeAsync();
      await codeClosed;
    },
  };
}

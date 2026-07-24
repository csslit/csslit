import { API } from "typescript/unstable/async";
import { Disposable, Position, commands, extensions } from "vscode";
import type { LogOutputChannel, TextDocument, CancellationToken, Event } from "vscode";
import { StaleSourceFileError, parseModule } from "./tsgo.ts";
import type { ParsedModule } from "./types.ts";

const TS_EXTENSION_ID = "TypeScriptTeam.native-preview";

interface NativePreviewExtensionAPI {
  onLanguageServerInitialized: Event<void>;
  initializeAPIConnection(pipe?: string): Promise<string>;
}

export class TypescriptParser implements Disposable {
  #extension: Promise<NativePreviewExtensionAPI | undefined> | undefined = undefined;
  #lspInitializedEventHandle: Disposable | undefined = undefined;
  #connection: Promise<API<boolean> | undefined> | undefined = undefined;
  readonly #output: LogOutputChannel;

  constructor(output: LogOutputChannel) {
    this.#output = output;
  }

  async parse(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Promise<ParsedModule | undefined> {
    const version = document.version;
    const source = document.getText();

    this.#extension ??= this.#openExtension();
    const extension = await this.#extension;
    if (!extension) return;

    this.#connection ??= this.#openConnection(extension);
    const connection = await this.#connection;
    if (!connection) return;

    const uri = document.uri.toString();
    try {
      try {
        const module = await parseModule(connection, uri, source);
        return document.version === version ? module : undefined;
      } catch (error) {
        // A stale snapshot means tsgo is behind; fall through to sync and retry. Anything else is
        // a real failure for the outer catch.
        if (!(error instanceof StaleSourceFileError)) throw error;
      }

      // tsgo's snapshot is behind VS Code's document. Requesting any TypeScript language feature
      // pushes the current document into tsgo; the result is discarded, the call is only a sync.
      this.#output.debug(`Waiting for tsgo to reach document version ${version}`);
      try {
        await commands.executeCommand("vscode.executeSelectionRangeProvider", document.uri, [
          position,
        ]);
      } catch (syncError) {
        this.#output.error("Synchronizing with tsgo failed", syncError);
        return;
      }
      if (token.isCancellationRequested || document.version !== version) return;

      // Retry now that the server has the document: updateSnapshot's change diff re-reads it.
      const module = await parseModule(connection, uri, source);
      return document.version === version ? module : undefined;
    } catch (error) {
      // Still stale after syncing almost always means the document was edited again while we were
      // processing, so our captured version is now obsolete and a newer request will handle it.
      // That is a race, not a connection fault: give up on this request but keep the connection.
      if (error instanceof StaleSourceFileError) return;
      this.#output.error("Locating templates with TypeScript 7 failed", error);
      this.#resetConnection();
      return;
    }
  }

  reset(): void {
    this.#lspInitializedEventHandle?.dispose();
    this.#lspInitializedEventHandle = undefined;
    this.#extension = undefined;
    this.#resetConnection();
  }

  dispose(): void {
    this.reset();
  }

  async #openExtension(): Promise<NativePreviewExtensionAPI | undefined> {
    try {
      const extension = extensions.getExtension(TS_EXTENSION_ID);
      if (!extension) return undefined;

      const extensionApi: NativePreviewExtensionAPI = await extension.activate();
      this.#lspInitializedEventHandle = extensionApi.onLanguageServerInitialized(() =>
        this.#resetConnection(),
      );
      return extensionApi;
    } catch (error) {
      this.#output.error("Activating the TypeScript native preview extension failed", error);
      return undefined;
    }
  }

  async #openConnection(extension: NativePreviewExtensionAPI): Promise<API<boolean> | undefined> {
    try {
      const pipe = await extension.initializeAPIConnection();
      const api = await API.fromLSPConnection({ pipe });
      this.#output.info("Connected to the TypeScript API session");
      return api;
    } catch (error) {
      this.#output.error("Connecting to the TypeScript 7 API session failed", error);
      return undefined;
    }
  }

  #resetConnection(): void {
    this.#connection
      ?.then((api) => api?.close())
      .catch((error) => this.#output.trace("Closing connection", error));
    this.#connection = undefined;
  }
}

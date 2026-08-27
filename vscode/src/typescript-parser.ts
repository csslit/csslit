import { API } from "typescript/unstable/async";
import { Position, commands, extensions } from "vscode";
import type { TextDocument, Event } from "vscode";
import { StaleSourceFileError, parseModule } from "./tsgo.ts";
import type { ParsedModule } from "./types.ts";

const TS_EXTENSION_ID = "TypeScriptTeam.native-preview";

interface NativePreviewExtensionAPI {
  onLanguageServerInitialized: Event<void>;
  initializeAPIConnection(pipe?: string): Promise<string>;
}

export async function createTypescriptParser() {
  const installed = extensions.getExtension(TS_EXTENSION_ID)!;
  const extension: NativePreviewExtensionAPI = await installed.activate();

  async function openConnection(): Promise<API<boolean>> {
    const pipe = await extension.initializeAPIConnection();
    return await API.fromLSPConnection({ pipe });
  }

  let connection = openConnection();
  function replaceConnection(): void {
    void connection.then((api) => api.close());
    connection = openConnection();
    void connection.catch(() => {});
  }

  const initialized = extension.onLanguageServerInitialized(replaceConnection);
  try {
    await connection;
  } catch (error) {
    initialized.dispose();
    throw error;
  }

  return {
    async parse(document: TextDocument, position: Position): Promise<ParsedModule | undefined> {
      const version = document.version;
      const source = document.getText();
      const api = await connection;

      const uri = document.uri.toString();
      try {
        return await parseModule(api, uri, source);
      } catch (error) {
        if (error instanceof StaleSourceFileError) {
          await commands.executeCommand("vscode.executeSelectionRangeProvider", document.uri, [
            position,
          ]);
          if (document.version !== version) return;
          return await parseModule(api, uri, source);
        }
        throw error;
      }
    },
    dispose(): void {
      initialized.dispose();
      void connection.then((api) => api.close());
    },
  };
}

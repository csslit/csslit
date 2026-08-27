import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { API } from "typescript/unstable/async";
import { parseModule } from "../tsgo.ts";
import { buildVirtualCss } from "../virtual-css.ts";
import type { TemplateLocator } from "./locator.ts";

const key = (name: string) =>
  name.replaceAll("\\", "/").replace(/^[a-zA-Z]:/, (drive) => drive.toLowerCase());

export function createTsgoLocator(): TemplateLocator {
  const path = join(process.cwd(), "__virtual__", "case.tsx");
  const uri = pathToFileURL(path).href;
  const file = key(path);
  let content: string | undefined;
  const api = new API({
    cwd: process.cwd(),
    fs: {
      readFile: (name) => (key(name) === file ? content : undefined),
      fileExists: (name) => (key(name) === file && content !== undefined ? true : undefined),
    },
  });

  return {
    async virtualCss(source, offset) {
      const exists = content !== undefined;
      content = source;
      const changed = await api.updateSnapshot({
        fileChanges: exists ? { changed: [{ uri }] } : { created: [{ uri }] },
      });
      await changed.dispose();
      const module = await parseModule(api, uri, source);
      return module && buildVirtualCss(module, offset);
    },
    async [Symbol.asyncDispose]() {
      void api.close();
    },
  };
}

import { expect, test } from "vite-plus/test";

import { build } from "../harness/csslit-harness.ts";

function decodeEmbeddedCssMap(code: string) {
  const match = code.match(/sourceMappingURL=data:application\/json;base64,([^*\s]+)/);
  if (!match) {
    return null;
  }

  const json = Buffer.from(match[1], "base64").toString("utf8");
  return JSON.parse(json) as { file?: string; sources?: string[] };
}

test("css module sourcemap uses root-relative source paths", async () => {
  const result = await build({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          color: hotpink;
        \`;
      `,
    },
    workspaceRooted: true,
  });

  const cssModule = result.writtenFiles[0];
  const embeddedCssMap = decodeEmbeddedCssMap(cssModule?.code ?? "");

  expect(result.runtime.map).not.toBeNull();
  expect(cssModule).toBeDefined();
  expect(embeddedCssMap).not.toBeNull();
  expect(embeddedCssMap?.sources).toEqual(["/src/entry.ts"]);
  expect(embeddedCssMap?.sources?.[0]).not.toMatch(/^[A-Za-z]:\//);
});

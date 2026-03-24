import { createServer } from "vite-plus";
import { cssCompilePlugin } from "@csslit/vite-plugin";
import { test, expect } from "vite-plus/test";
import path from "node:path";

test("CSS source map extraction and remapping", async () => {
  console.log("Starting test...");
  const root = path.resolve(__dirname, "../../playground");
  console.log("Root:", root);
  const server = await createServer({
    root,
    plugins: [cssCompilePlugin()],
    server: { middlewareMode: true },
  });

  try {
    const id = "/src/App.tsx";
    const absId = path.join(root, id);
    
    // 1. Transform the runtime module first
    await server.transformRequest(id);

    // 2. Load the CSS module (this triggers eval import)
    const cssId = `virtual:css-compile/${absId}?id=1.module.css`;
    const result = await server.transformRequest(cssId);

    expect(result).toBeDefined();
    console.log("CSS Code:", result?.code);
    console.log("CSS Map:", JSON.stringify(result?.map, null, 2));

    // Verify mapping
    const map = result?.map;
    expect(map?.sources).toContain("src/App.tsx");
    expect(map?.mappings).toContain(";"); // Check if shifted

  } finally {
    await server.close();
  }
});

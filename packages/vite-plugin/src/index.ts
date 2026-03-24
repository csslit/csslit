import { transform as rustTransform } from "@csslit/rust-transformer";
import path from "node:path";
import remapping from "@jridgewell/remapping";
import { type Plugin, type ViteDevServer, normalizePath } from "vite";

const VIRTUAL_CSS_ID_PREFIX = "virtual:css-compile/";

export function cssCompilePlugin(): Plugin {
  let buildServer: ViteDevServer | null = null;
  let devServer: ViteDevServer | null = null;
  let root = process.cwd();

  return {
    name: "vite-plugin-css-compile",
    enforce: "pre",

    configureServer(server) {
      devServer = server;
    },

    async buildEnd() {
      if (buildServer) await buildServer.close();
    },

    async configResolved(config) {
      root = config.root;
    },

    async transform(code: string, id: string) {
      // Use cleanId for file type check
      const [cleanId, query] = id.split("?");
      if (id.includes("node_modules") || id.startsWith("\0") || !id.includes(root)) return null;
      if (!/\.[jt]sx?$/.test(cleanId)) return null;

      const relativeId = path.relative(root, cleanId).replace(/\\/g, "/");
      const isEval = query?.includes("css-compile-eval");

      if (isEval) {
        // Extraction transformation: Create a module with CSS metadata exports
        // Use full relative ID with query for correct source map source identification in Rust
        const filename = path.relative(root, id).replace(/\\/g, "/");
        const result = rustTransform(code, { mode: "compileTime", filename });
        
        return { 
          code: result.code, 
          map: result.map ? JSON.parse(result.map) : null 
        };
      }

      // Macro transformation: Replace template with class name and add virtual import
      const result = rustTransform(code, { mode: "runtime", filename: relativeId });
      if (result.code === code) return null;

      return { 
        code: result.code, 
        map: result.map ? JSON.parse(result.map) : null 
      };
    },

    resolveId(source) {
      if (source.includes(VIRTUAL_CSS_ID_PREFIX)) {
        return "\0" + source;
      }
      return null;
    },

    async load(id) {
      if (id.includes(VIRTUAL_CSS_ID_PREFIX)) {
        const virtualId = id.replace(/^\0/, "");
        const match = virtualId.match(/virtual:css-compile\/(.*)\?id=(\d+)/);
        
        if (match) {
          const [, absPath, index] = match;
          const normalizedAbsPath = normalizePath(absPath);
          const evalId = `${normalizedAbsPath}?css-compile-eval`;

          const server = devServer || buildServer || (this as any).environment?.server;
          if (!server) return null;

          try {
            // Trigger transformation of the extraction module
            await server.transformRequest(evalId);
            
            // Get the module from graph to access its own transform results (for JS mapping)
            const evalMod = server.moduleGraph.getModuleById(evalId) || server.moduleGraph.getModuleByUrl(evalId);
            
            // Evaluate the module to get the generated CSS
            const mod = await server.ssrLoadModule(evalId);
            const getCss = mod[`__ext_css_${index}`];

            if (!getCss) {
              console.error(`[Plugin] CSS function __ext_css_${index} not found in ${evalId}`);
              return null;
            }

            const { css, map: mapRaw } = getCss();
            const cssMap = typeof mapRaw === "string" ? JSON.parse(mapRaw) : mapRaw;
            
            // wrap in selector and add a line break to match shifted mappings if needed
            // Our current Rust transformer produces maps for the full program content,
            // so if we wrap it, we should ideally shift. 
            // However, a simple multiline string is safer for now.
            const generatedCss = `.css-${index} {\n${css}\n}`;
            
            // Prepare for remapping. Remap the CSS block's map against the TSX's JS transform map.
            let finalMap = cssMap;
            const jsMap = evalMod?.ssrTransformResult?.map || (evalMod as any)?.transformResult?.map;

            if (jsMap && cssMap && cssMap.mappings) {
              // Shift cssMap mappings by 1 line to account for the selector prefix `.css-N { \n`
              const shiftedMappings = ";" + cssMap.mappings;
              const shiftedCssMap = { ...cssMap, mappings: shiftedMappings };

              finalMap = remapping(shiftedCssMap as any, (file) => {
                const matchName = file === cssMap.sources[0] || normalizePath(file) === normalizedAbsPath;
                if (matchName) return jsMap as any;
                return null;
              }) as any;
            }

            return { code: generatedCss, map: finalMap };
          } catch (err: any) {
            console.error(`[Plugin] CSS Extraction failed for ${id}:`, err);
            return null;
          }
        }
      }
      return null;
    },
  };
}

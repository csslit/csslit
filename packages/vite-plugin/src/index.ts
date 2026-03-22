import type { Plugin, ResolvedConfig } from 'vite';
import { transform as rustTransform } from '@csslit/rust-transformer';

import { createServer, type ViteDevServer } from 'vite';

export function cssCompilePlugin(): Plugin {
  let buildServer: ViteDevServer | null = null;
  let devServer: ViteDevServer | null = null;
  return {
    name: 'vite-plugin-css-compile',
    enforce: 'pre',

    configureServer(server) {
      devServer = server;
    },
    
    async buildEnd() {
      if (buildServer) await buildServer.close();
    },

    async configResolved(config) {
      if (config.command === 'build' && !process.env.VITE_INTERNAL_RUNNER) {
         process.env.VITE_INTERNAL_RUNNER = '1';
         buildServer = await createServer({
           configFile: config.configFile,
           server: { middlewareMode: true },
           environments: {
             compileTime: {
               resolve: {
                 conditions: ['node', 'import', 'require']
               }
             }
           }
         });
      }
    },

    config() {
      return {
        environments: {
          compileTime: {
            resolve: {
              conditions: ['node', 'import', 'require']
            }
          }
        }
      };
    },

    async transform(code: string, id: string) {
      if (id.includes('node_modules') || id.startsWith('\0')) return null;
      const cleanId = id.split('?')[0];
      if (!/\.[jt]sx?$/.test(cleanId)) return null;

      const isEval = id.includes('css-compile-eval');
      
      if (isEval) {
        const result = rustTransform(code, { mode: 'compileTime', filename: id });
        return { code: result.code, map: null };
      }

      const result = rustTransform(code, { mode: 'runtime', filename: id });
      
      if (result.code === code) return null;
      return { code: result.code, map: null };
    },

    resolveId(source) {
      if (source.includes('virtual:css-compile')) {
        return '\0' + source; 
      }
      return null;
    },

    async load(id) {
      if (id.startsWith('\0virtual:css-compile')) {
        const originalId = id.replace('\0virtual:css-compile/', '').split('?')[0];
        
        const server = devServer || buildServer || (this as any).environment?.server;
        if (!server) {
           return `/* Error */`;
        }

        try {
          const evalId = originalId + (originalId.includes('?') ? '&' : '?') + 'css-compile-eval';
          const mod = await server.ssrLoadModule(evalId);
          const extractIndex = id.match(/id=([0-9]+)/)?.[1] || '1';
          const exportName = '__ext_css_' + extractIndex;
          const rawCss = mod[exportName] ? mod[exportName]() : `/* No CSS */`;
          const generatedCss = `.hashed_class {\n${rawCss}\n}`;
          
          const compileModNode = server.moduleGraph.getModuleById(originalId);
          if (compileModNode && compileModNode.importedModules) {
            for (const imported of compileModNode.importedModules) {
               if (imported.file) this.addWatchFile(imported.file);
            }
          }
          this.addWatchFile(originalId);

          return generatedCss;
        } catch (e: any) {
          return `/* Execution Error */`;
        }
      }
      return null;
    }
  };
}

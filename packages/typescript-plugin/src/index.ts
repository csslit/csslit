import type ts from "typescript6/lib/tsserverlibrary";
import { collectTemplateEdits, hasCssTemplate } from "./templates.ts";

type TypeScript = typeof ts;

// A private refactor is how the editor pulls csslit's template spans out of tsserver. Registering
// this as a project plugin (in tsconfig `plugins`) before a framework plugin such as
// @tsrx/typescript-plugin keeps it innermost, so the framework proxy wraps it and maps the returned
// edits back to the source document — no special handling of the proxy is required here.
export default function init({ typescript }: { typescript: TypeScript }): ts.server.PluginModule {
  return {
    create(info) {
      info.project.projectService.logger.info("csslit: TypeScript plugin created");
      const languageService = info.languageService;
      const getApplicableRefactors = languageService.getApplicableRefactors.bind(languageService);
      const getEditsForRefactor = languageService.getEditsForRefactor.bind(languageService);

      languageService.getApplicableRefactors = (...args) => {
        const refactors = getApplicableRefactors(...args);
        if (args[4] !== "refactor.csslit.findTemplates") return refactors;
        const sourceFile = languageService.getProgram()?.getSourceFile(args[0]);
        if (!sourceFile || !hasCssTemplate(typescript, sourceFile)) return refactors;
        return [
          ...refactors,
          {
            name: "csslit.findTemplates",
            description: "Locate csslit templates",
            actions: [
              {
                name: "csslit.findTemplates",
                description: "Locate csslit templates",
                kind: "refactor.csslit.findTemplates",
              },
            ],
          },
        ];
      };
      languageService.getEditsForRefactor = (...args) => {
        if (args[3] !== "csslit.findTemplates" || args[4] !== "csslit.findTemplates")
          return getEditsForRefactor(...args);
        const sourceFile = languageService.getProgram()?.getSourceFile(args[0]);
        if (!sourceFile) return;
        const textChanges = collectTemplateEdits(typescript, sourceFile);
        if (textChanges.length === 0) return;
        return { edits: [{ fileName: args[0], textChanges }] };
      };

      return languageService;
    },
  };
}

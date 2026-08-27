import { connect } from "node:net";
import type ts from "typescript6/lib/tsserverlibrary";
import { collectTemplateEdits } from "./templates.ts";

const FIND_TEMPLATES_COMMAND = "_csslit:findTemplates";
const PLUGIN_NAME = "@csslit/typescript-plugin";

type ProjectWithPlugins = ts.server.Project & {
  plugins: readonly { name: string }[];
};

type TestReadiness = {
  port: number;
  file: string;
  expectedFrameworkPlugin?: string;
};

type PluginConfig = { testReadiness?: TestReadiness };

type TestSession = {
  frameworkVerification?: {
    source: string;
    mappedSourceObserved: boolean;
  };
  projects: ts.server.Project[];
  readiness?: TestReadiness;
  session: ts.server.Session<unknown>;
  readySignalSent: boolean;
  typescript: typeof ts;
};

const testSessions = new WeakMap<ts.server.Session<unknown>, TestSession>();

type FindTemplatesArguments = {
  file: string;
  line: number;
  offset: number;
  verifyFrameworkSource?: string;
};

function answerFindTemplates(testSession: TestSession, request: ts.server.protocol.Request): void {
  const arguments_ = request.arguments as FindTemplatesArguments;

  try {
    if (arguments_.verifyFrameworkSource !== undefined) {
      const sourceFile = testSession.typescript.createSourceFile(
        arguments_.file,
        arguments_.verifyFrameworkSource,
        testSession.typescript.ScriptTarget.Latest,
        false,
        testSession.typescript.ScriptKind.TS,
      ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
      if (sourceFile.parseDiagnostics.length === 0) {
        throw new Error("Test source is valid TypeScript");
      }
    }
    const frameworkVerification: TestSession["frameworkVerification"] =
      arguments_.verifyFrameworkSource === undefined
        ? undefined
        : { source: arguments_.verifyFrameworkSource, mappedSourceObserved: false };
    testSession.frameworkVerification = frameworkVerification;
    const position = {
      file: arguments_.file,
      startLine: arguments_.line,
      startOffset: arguments_.offset,
      endLine: arguments_.line,
      endOffset: arguments_.offset,
    };
    const applicable = testSession.session.executeCommand({
      ...request,
      command: "getApplicableRefactors",
      arguments: {
        ...position,
        triggerReason: "invoked",
        kind: "refactor.csslit.findTemplates",
        includeInteractiveActions: true,
      },
    }).response as ts.ApplicableRefactorInfo[] | undefined;
    const answered = applicable?.some((refactor) =>
      refactor.actions?.some(({ name }) => name === "csslit.findTemplates"),
    );

    let edits: ts.server.protocol.FileCodeEdits[] = [];
    if (answered) {
      const response = testSession.session.executeCommand({
        ...request,
        command: "getEditsForRefactor",
        arguments: {
          ...position,
          refactor: "csslit.findTemplates",
          action: "csslit.findTemplates",
        },
      }).response as ts.server.protocol.RefactorEditInfo | undefined;
      edits = response?.edits ?? [];
    }

    testSession.session.send({
      seq: 0,
      type: "response",
      command: request.command,
      request_seq: request.seq,
      success: true,
      body: {
        answered: answered === true,
        edits,
        frameworkMapped: frameworkVerification?.mappedSourceObserved,
      },
    } as ts.server.protocol.Response);
  } catch (error) {
    testSession.session.send({
      seq: 0,
      type: "response",
      command: request.command,
      request_seq: request.seq,
      success: false,
      message: String(error),
    } as ts.server.protocol.Response);
  } finally {
    testSession.frameworkVerification = undefined;
  }
}

function announceReady(session: TestSession): void {
  if (session.readySignalSent) return;
  const readiness = session.readiness;
  if (!readiness) return;

  let readyProject: ts.server.Project | undefined;
  for (const project of session.projects) {
    const plugins = (project as ProjectWithPlugins).plugins;
    const csslit = plugins.findIndex((plugin) => plugin.name === PLUGIN_NAME);
    if (csslit === -1) continue;
    if (readiness.expectedFrameworkPlugin) {
      const framework = plugins.findIndex(
        (plugin) => plugin.name === readiness.expectedFrameworkPlugin,
      );
      if (framework <= csslit) continue;
    }
    if (project.getLanguageService().getProgram()?.getSourceFile(readiness.file)) {
      readyProject = project;
      break;
    }
  }
  if (!readyProject) return;

  session.readySignalSent = true;
  const socket = connect(readiness.port, "127.0.0.1");
  socket.end();
  socket.unref();
  socket.on("error", (error) => {
    readyProject.projectService.logger.info(
      `csslit: could not announce test readiness: ${error.message}`,
    );
  });
}

export default (function init({ typescript }) {
  let projectSession: TestSession | undefined;

  return {
    create(info) {
      info.project.projectService.logger.info("csslit: TypeScript plugin created");
      if (info.session) {
        let session = testSessions.get(info.session);
        if (!session) {
          const created: TestSession = {
            projects: [],
            session: info.session,
            readySignalSent: false,
            typescript,
          };
          session = created;
          testSessions.set(info.session, created);
          info.session.addProtocolHandler(FIND_TEMPLATES_COMMAND, (request) => {
            queueMicrotask(() => answerFindTemplates(created, request));
            return { responseRequired: false };
          });
        }
        session.projects.push(info.project);
        projectSession = session;
      }
      if (projectSession) {
        projectSession.readiness = (info.config as PluginConfig).testReadiness;
        announceReady(projectSession);
      }

      const languageService = info.languageService;
      const getApplicableRefactors = languageService.getApplicableRefactors.bind(languageService);
      const getEditsForRefactor = languageService.getEditsForRefactor.bind(languageService);

      languageService.getApplicableRefactors = (...args) => {
        const refactors = getApplicableRefactors(...args);
        if (args[4] !== "refactor.csslit.findTemplates") return refactors;
        const sourceFile = languageService.getProgram()?.getSourceFile(args[0]);
        if (!sourceFile) return refactors;
        const verification = projectSession?.frameworkVerification;
        if (verification && sourceFile.text !== verification.source)
          verification.mappedSourceObserved = true;
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
    getExternalFiles() {
      if (projectSession) announceReady(projectSession);
      return [];
    },
    onConfigurationChanged(config: PluginConfig) {
      if (!projectSession) return;
      projectSession.readiness = config.testReadiness;
      announceReady(projectSession);
    },
  };
} satisfies ts.server.PluginModuleFactory);

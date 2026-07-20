// @ts-expect-error @tsrx/core points its types export at JavaScript source.
import * as tsrxCore from "@tsrx/core";
import type { CssTemplate, ParsedModule } from "./types.ts";

const parseTsrxModule = (
  tsrxCore as {
    parseModule(source: string, filename: string, options?: { loose?: boolean }): unknown;
  }
).parseModule;

type EstreeNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

type TaggedTemplate = EstreeNode & {
  tag:
    | (EstreeNode & { type: "Identifier"; name: string })
    | (EstreeNode & {
        type: "MemberExpression";
        computed: boolean;
        object: EstreeNode & { type: "Identifier"; name: string };
        property: EstreeNode & { type: "Identifier"; name: string };
      });
  quasi: EstreeNode & {
    quasis: Array<EstreeNode & { value: { raw: string; cooked: string | null } }>;
  };
};

let cachedSource: string | undefined;
let cachedFilename: string | undefined;
let cachedModule: ParsedModule | undefined;

export function parseModule(source: string, filename: string): ParsedModule | undefined {
  if (source === cachedSource && filename === cachedFilename) return cachedModule;

  let program: EstreeNode;
  try {
    program = parseTsrxModule(source, filename, { loose: true }) as unknown as EstreeNode;
  } catch (error) {
    if (error instanceof SyntaxError) return cache(source, filename, undefined);
    throw error;
  }

  const templates: CssTemplate[] = [];
  const visit = (node: EstreeNode): void => {
    if (node.type === "TaggedTemplateExpression") {
      const tagged = node as TaggedTemplate;
      const global = cssTagKind(tagged.tag);
      if (global !== undefined) {
        templates.push({
          global,
          quasis: tagged.quasi.quasis.map((quasi) => ({
            start: quasi.start,
            end: quasi.end,
            cooked: quasi.value.cooked ?? source.slice(quasi.start, quasi.end),
          })),
        });
      }
    }

    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };
  visit(program);
  return cache(source, filename, { source, templates });
}

function cache(source: string, filename: string, module: ParsedModule | undefined) {
  cachedSource = source;
  cachedFilename = filename;
  return (cachedModule = module);
}

function isNode(value: unknown): value is EstreeNode {
  return (
    typeof value === "object" && value !== null && typeof (value as EstreeNode).type === "string"
  );
}

function cssTagKind(tag: TaggedTemplate["tag"]): boolean | undefined {
  if (tag.type === "Identifier" && tag.name === "css") return false;
  if (
    tag.type === "MemberExpression" &&
    !tag.computed &&
    tag.object.type === "Identifier" &&
    tag.object.name === "css" &&
    tag.property.type === "Identifier" &&
    tag.property.name === "global"
  )
    return true;
  return undefined;
}

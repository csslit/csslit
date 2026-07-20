// Generates boundary-safe CSS/SCSS grammars. See ../ARCHITECTURE.md.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { toOnigurumaAst } from "oniguruma-parser";
import { generate } from "oniguruma-parser/generator";

const BOUNDARY_BAIL = "(?=`|\\$\\{)";
const GUARD = "(?!`|\\$\\{|\\\\[`$\\\\])";
const BOUNDARY_CHARS = [0x60, 0x24, 0x5c]; // ` $ \

type AstNode = {
  type: string;
  kind?: string;
  negate?: boolean;
  value?: number;
  min?: AstNode;
  max?: AstNode;
  body?: AstNode | AstNode[];
  flags?: { enable?: Record<string, boolean>; disable?: Record<string, boolean> };
};

// The parser resolves extended-mode whitespace, while the generator emits normalized regexes.
function stripExtendedFlag(node: AstNode): boolean {
  const flags = node.flags;
  if (!flags) return true;
  if (flags.enable) delete flags.enable["extended"];
  if (flags.disable) delete flags.disable["extended"];
  const empty = (record?: Record<string, boolean>) => !record || Object.keys(record).length === 0;
  if (empty(flags.enable) && empty(flags.disable)) {
    delete node.flags;
    return node.type !== "Directive"; // a bare (?) directive is not emittable
  }
  return true;
}

function stripExtendedDeep(node: AstNode): void {
  const body = node.body;
  if (Array.isArray(body)) {
    for (const child of body) {
      if (child.type === "Alternative") {
        child.body = (child.body as AstNode[]).filter(stripExtendedFlag);
      }
      stripExtendedDeep(child);
    }
  } else if (body) {
    stripExtendedFlag(body);
    stripExtendedDeep(body);
  }
}

const parseFragment = (source: string): AstNode => {
  const regex = toOnigurumaAst(source) as AstNode;
  return ((regex.body as AstNode[])[0]!.body as AstNode[])[0]!;
};
const guardNode = parseFragment(GUARD);
const bailNode = parseFragment(BOUNDARY_BAIL);

const characterSetMisses: Record<string, (cp: number) => boolean> = {
  digit: (cp) => cp >= 0x30 && cp <= 0x39,
  hex: (cp) =>
    (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x46) || (cp >= 0x61 && cp <= 0x66),
  space: (cp) => cp === 0x20 || (cp >= 0x09 && cp <= 0x0d),
  word: (cp) =>
    cp === 0x5f ||
    (cp >= 0x30 && cp <= 0x39) ||
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a),
};

function matchesChar(node: AstNode, cp: number): boolean {
  switch (node.type) {
    case "Character":
      return node.value === cp;
    case "CharacterClassRange":
      return node.min!.value! <= cp && cp <= node.max!.value!;
    case "CharacterSet": {
      const misses = characterSetMisses[node.kind!];
      if (!misses) return true; // dot and anything exotic: assume it matches
      const hit = misses(cp);
      return node.negate ? !hit : hit;
    }
    case "CharacterClass": {
      if (node.kind !== "union") return true;
      const hit = (node.body as AstNode[]).some((member) => matchesChar(member, cp));
      return node.negate ? !hit : hit;
    }
    default:
      return true;
  }
}

const canTouchBoundary = (node: AstNode) => BOUNDARY_CHARS.some((cp) => matchesChar(node, cp));

const group = (...alternatives: AstNode[][]): AstNode => ({
  type: "Group",
  body: alternatives.map((body) => ({ type: "Alternative", body })),
});

function guardElement(element: AstNode, path: string): AstNode {
  switch (element.type) {
    case "Quantifier":
      element.body = guardElement(element.body as AstNode, path);
      return element;
    case "Group":
    case "CapturingGroup":
      guardAlternatives(element.body as AstNode[], path);
      return element;
    case "LookaroundAssertion":
      if (element.kind !== "lookbehind") guardAlternatives(element.body as AstNode[], path);
      return element;
    case "Assertion":
      if (element.kind === "line_end") {
        return group([{ type: "Assertion", kind: "line_end" }], [structuredClone(bailNode)]);
      }
      return element;
    case "Character":
    case "CharacterSet":
    case "CharacterClass":
      return canTouchBoundary(element) ? group([structuredClone(guardNode), element]) : element;
    case "Directive":
      if (element.kind !== "flags")
        throw new Error(`${path}: unsupported regex directive ${element.kind}`);
      return element;
    default:
      throw new Error(`${path}: unsupported regex construct ${element.type}`);
  }
}

function guardAlternatives(alternatives: AstNode[], path: string): void {
  for (const alternative of alternatives) {
    alternative.body = (alternative.body as AstNode[]).map((element) =>
      guardElement(element, path),
    );
  }
}

function patchRegex(source: string, kind: "match" | "begin" | "end", path: string): string {
  const ast = toOnigurumaAst(source) as AstNode;
  stripExtendedDeep(ast);
  guardAlternatives(ast.body as AstNode[], path);
  const { pattern, flags } = generate(ast as never);
  if (flags !== "") throw new Error(`${path}: unexpected top-level flags "${flags}"`);
  if (kind === "end") return `${BOUNDARY_BAIL}|(?:${pattern})`;
  return `${GUARD}(?:${pattern})`;
}

type TmRule = {
  include?: string;
  match?: string;
  begin?: string;
  end?: string;
  while?: string;
  patterns?: TmRule[];
  captures?: Record<string, TmRule>;
  beginCaptures?: Record<string, TmRule>;
  endCaptures?: Record<string, TmRule>;
  repository?: Record<string, TmRule>;
  [key: string]: unknown;
};

function patchGrammar(
  grammar: TmRule,
  scopeRenames: Record<string, string>,
  droppedIncludes: string[],
): void {
  if (grammar["injections"])
    throw new Error("embedded grammar declares injections; transform does not model them");

  const rewriteInclude = (include: string, path: string): string => {
    if (include.startsWith("#") || include === "$self") return include;
    if (include === "$base")
      throw new Error(`${path}: $base include would splice in unguarded host rules`);
    const hash = include.indexOf("#");
    const scope = hash === -1 ? include : include.slice(0, hash);
    const renamed = scopeRenames[scope];
    if (!renamed) throw new Error(`${path}: include of grammar outside the patch set: ${scope}`);
    return renamed + (hash === -1 ? "" : include.slice(hash));
  };

  const walk = (rule: TmRule, path: string): void => {
    if (rule.while !== undefined) {
      throw new Error(`${path}: while rules cannot bail at a template boundary`);
    }
    if (rule.match !== undefined) rule.match = patchRegex(rule.match, "match", path);
    if (rule.begin !== undefined) rule.begin = patchRegex(rule.begin, "begin", path);
    if (rule.end !== undefined) rule.end = patchRegex(rule.end, "end", path);
    if (rule.include !== undefined) rule.include = rewriteInclude(rule.include, path);
    if (rule.patterns) {
      rule.patterns = rule.patterns.filter((child) => !droppedIncludes.includes(child.include!));
      rule.patterns.forEach((child, index) => walk(child, `${path}.patterns[${index}]`));
    }
    for (const key of ["captures", "beginCaptures", "endCaptures"] as const) {
      const captures = rule[key];
      if (captures)
        for (const [index, child] of Object.entries(captures))
          walk(child, `${path}.${key}[${index}]`);
    }
    if (rule.repository) {
      for (const [name, child] of Object.entries(rule.repository)) walk(child, `${path} > ${name}`);
    }
  };
  walk(grammar, String(grammar["scopeName"]));
}

type Host = { language: string; scope: string; suffix: string };
const hosts: Host[] = [
  { language: "javascript", scope: "source.js", suffix: "js" },
  { language: "javascriptreact", scope: "source.js.jsx", suffix: "js.jsx" },
  { language: "typescript", scope: "source.ts", suffix: "ts" },
  { language: "typescriptreact", scope: "source.tsx", suffix: "tsx" },
];

function templateRule(host: Host, global: boolean): TmRule {
  const punctuation = (edge: string) =>
    `string.template.${host.suffix} punctuation.definition.string.template.${edge}.${host.suffix}`;
  return {
    begin: global ? "\\b(css)\\s*(\\.)\\s*(global)\\s*(`)" : "\\b(css)\\s*(`)",
    beginCaptures: global
      ? {
          "1": { name: `entity.name.function.tagged-template.${host.suffix}` },
          "2": { name: `punctuation.accessor.${host.suffix}` },
          "3": { name: `entity.name.function.tagged-template.${host.suffix}` },
          "4": { name: punctuation("begin") },
        }
      : {
          "1": { name: `entity.name.function.tagged-template.${host.suffix}` },
          "2": { name: punctuation("begin") },
        },
    end: "`",
    endCaptures: { "0": { name: punctuation("end") } },
    contentName: global
      ? "meta.embedded.inline.csslit"
      : "meta.embedded.inline.csslit meta.property-list.scss",
    patterns: global
      ? [{ include: "source.csslit.scss" }]
      : [
          { include: "source.csslit.scss#rules" },
          { include: "source.csslit.scss#properties" },
          { include: "source.csslit.scss" },
        ],
  };
}

const wrapperGrammar = (host: Host) => ({
  information_for_contributors: GENERATED_NOTE,
  scopeName: `csslit.${host.language}.injection`,
  // Do not recognize another css tag inside the current embedded template.
  injectionSelector: `L:${host.scope} -comment -string -meta.embedded.inline.csslit`,
  patterns: [templateRule(host, true), templateRule(host, false)],
});

const holesGrammar = (host: Host) => ({
  information_for_contributors: GENERATED_NOTE,
  scopeName: `csslit.${host.language}.holes.injection`,
  // Stay active at every CSS depth without reinjecting inside the host expression.
  injectionSelector: `L:${host.scope} meta.embedded.inline.csslit -meta.template.expression -string.template`,
  patterns: [
    { match: "\\\\[`$\\\\]", name: `constant.character.escape.${host.suffix}` },
    {
      // Match the host template scope so themes style interpolation punctuation normally.
      name: `string.template.${host.suffix}`,
      begin: "(?=\\$\\{)",
      end: "(?<=\\})",
      // The substitution must consume before the zero-width end, including for adjacent holes.
      applyEndPatternLast: true,
      patterns: [{ include: `${host.scope}#template-substitution-element` }],
    },
  ],
});

const syntaxesDir = join(import.meta.dirname, "..", "generated", "syntaxes");
const require = createRequire(import.meta.url);
const grammarPath = (name: string) => require.resolve(`tm-grammars/grammars/${name}.json`);
const tmGrammars = JSON.parse(
  readFileSync(join(dirname(grammarPath("css")), "..", "package.json"), "utf8"),
);
const GENERATED_NOTE = `Generated by grammar/build-grammars.mts from tm-grammars@${tmGrammars.version} — run \`vp run grammars\` after editing the generator; do not edit this file.`;

const scopeRenames: Record<string, string> = {
  "source.css": "source.csslit.css",
  "source.css.scss": "source.csslit.scss",
};

const outputs = new Map<string, object>();

for (const name of ["css", "scss"]) {
  const grammar = JSON.parse(readFileSync(grammarPath(name), "utf8")) as TmRule;
  const scope = scopeRenames[String(grammar["scopeName"])]!;
  patchGrammar(grammar, scopeRenames, ["source.sassdoc"]);
  outputs.set(`csslit-${name}.tmLanguage.json`, {
    information_for_contributors: GENERATED_NOTE,
    ...grammar,
    scopeName: scope,
  });
}

for (const host of hosts) {
  outputs.set(`csslit-${host.language}.tmLanguage.json`, wrapperGrammar(host));
  outputs.set(`csslit-${host.language}-holes.tmLanguage.json`, holesGrammar(host));
}

mkdirSync(syntaxesDir, { recursive: true });
for (const stale of readdirSync(syntaxesDir)) {
  if (!outputs.has(stale)) rmSync(join(syntaxesDir, stale));
}
for (const [name, grammar] of outputs) {
  writeFileSync(join(syntaxesDir, name), JSON.stringify(grammar, null, 2) + "\n");
  console.log(`syntaxes/${name}`);
}

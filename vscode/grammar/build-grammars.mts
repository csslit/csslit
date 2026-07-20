// Generates a boundary-safe CSS grammar. See ../ARCHITECTURE.md.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { toOnigurumaAst } from "oniguruma-parser";
import { generate } from "oniguruma-parser/generator";

const BOUNDARY_BAIL = "(?=`|\\$\\{)";
const TEMPLATE_END = "(?=`)";
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
const templateEndNode = parseFragment(TEMPLATE_END);

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
        return group([{ type: "Assertion", kind: "line_end" }], [structuredClone(templateEndNode)]);
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
  name?: string;
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

/** Generic pass: Make every rule safe at template boundaries after grammar-specific changes. */
function patchGrammar(grammar: TmRule, scopeRenames: Record<string, string>): void {
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

/** CSS pass: Adapt and extend the pinned grammar using its known repository structure. */
function patchCssGrammar(grammar: TmRule): void {
  const repository = grammar.repository!;

  const selector = repository["selector"]!;
  const selectorBoundary =
    "  | ;                             # Semicolon (condensed property list syntax)";
  if (!selector.begin?.includes(selectorBoundary)) throw new Error("CSS selector boundary changed");
  selector.begin = selector.begin.replace(
    selectorBoundary,
    "  | `                             # Tagged-template boundary\n" + selectorBoundary,
  );

  const pseudoName =
    "(?:[-a-zA-Z_]|[^\\x00-\\x7F]|\\\\(?:[0-9a-fA-F]{1,6}|.))(?:[-\\w]|[^\\x00-\\x7F]|\\\\(?:[0-9a-fA-F]{1,6}|.))*";
  const functionEnd = {
    end: "\\)",
    endCaptures: { "0": { name: "punctuation.section.function.end.bracket.round.css" } },
  };
  const pseudoClassFunction = (names: string, patterns: TmRule[]): TmRule => ({
    begin: `(?i)((:)(?:${names}))(\\()`,
    beginCaptures: {
      "1": { name: "entity.other.attribute-name.pseudo-class.css" },
      "2": { name: "punctuation.definition.entity.css" },
      "3": { name: "punctuation.section.function.begin.bracket.round.css" },
    },
    ...functionEnd,
    patterns,
  });
  const pseudoElementFunction = (names: string, patterns: TmRule[]): TmRule => ({
    begin: `(?i)((::)(?:${names}))(\\()`,
    beginCaptures: {
      "1": { name: "entity.other.attribute-name.pseudo-element.css" },
      "2": { name: "punctuation.definition.entity.css" },
      "3": { name: "punctuation.section.function.begin.bracket.round.css" },
    },
    ...functionEnd,
    patterns,
  });
  const viewTransitionName = "variable.parameter.view-transition-name.css";
  const viewTransitionType = "variable.parameter.view-transition-type.css";
  const viewTransitionClass = "variable.parameter.view-transition-class.css";
  const viewTransitionNames: TmRule[] = [
    {
      match: `(\\.)(${pseudoName})`,
      captures: {
        "1": { name: `${viewTransitionClass} punctuation.definition.entity.css` },
        "2": { name: viewTransitionClass },
      },
    },
    { match: pseudoName, name: viewTransitionName },
  ];
  const viewTransitionTypes = pseudoClassFunction("active-view-transition-type", [
    { match: pseudoName, name: viewTransitionType },
    { include: "#property-values" },
  ]);
  viewTransitionTypes.name = "meta.function.pseudo-class.view-transition.css";
  const viewTransitionElements = pseudoElementFunction(
    "view-transition-(?:group(?:-children)?|image-pair|new|old)",
    [
      { match: "\\*", name: "entity.name.tag.wildcard.css" },
      ...viewTransitionNames,
      { include: "#property-values" },
    ],
  );
  viewTransitionElements.name = "meta.function.pseudo-element.view-transition.css";

  const selectorPatterns = repository["selector-innards"]!.patterns!;
  const customElement = selectorPatterns.findIndex(
    (rule) => rule.name === "entity.name.tag.custom.css",
  );
  if (customElement === -1) throw new Error("CSS custom-element rule changed");
  selectorPatterns.splice(
    customElement,
    0,
    pseudoClassFunction("host|host-context|global|local", [{ include: "#selector-innards" }]),
    viewTransitionTypes,
    pseudoClassFunction("state", [{ include: "#property-values" }]),
    pseudoElementFunction("cue|cue-region|slotted", [{ include: "#selector-innards" }]),
    viewTransitionElements,
    pseudoElementFunction("highlight|part|picker|scroll-button", [{ include: "#property-values" }]),
    {
      match: "(?i)(:)(?:global|local)(?![-\\w]|\\s*[;(}])",
      captures: { "1": { name: "punctuation.definition.entity.css" } },
      name: "entity.other.attribute-name.pseudo-class.css",
    },
    {
      match:
        "(?i)(:)(?:active-view-transition|autofill|blank|buffering|current|defined|future|has-slotted|local-link|modal|muted|open|past|paused|picture-in-picture|placeholder-shown|playing|popover-open|seeking|stalled|target-current|target-within|user-invalid|user-valid|volume-locked|xr-overlay)(?![-\\w]|\\s*[;}])",
      captures: { "1": { name: "punctuation.definition.entity.css" } },
      name: "entity.other.attribute-name.pseudo-class.css",
    },
    {
      match:
        "(?i)(::)(?:checkmark|cue-region|details-content|file-selector-button|picker-icon|scroll-marker|scroll-marker-group|target-text|view-transition)(?![-\\w]|\\s*[;}])",
      captures: { "1": { name: "punctuation.definition.entity.css" } },
      name: "entity.other.attribute-name.pseudo-element.css",
    },
    pseudoElementFunction(pseudoName, [{ include: "#selector-innards" }]),
    pseudoClassFunction(pseudoName, [{ include: "#selector-innards" }]),
    {
      match: `(::)${pseudoName}(?![-\\w]|\\s*\\()`,
      captures: { "1": { name: "punctuation.definition.entity.css" } },
      name: "entity.other.attribute-name.pseudo-element.css",
    },
    {
      match: `(:)${pseudoName}(?![-\\w]|\\s*\\()`,
      captures: { "1": { name: "punctuation.definition.entity.css" } },
      name: "entity.other.attribute-name.pseudo-class.css",
    },
  );

  const sharedNames = repository["shared-names"]!;
  const sharedFunctions = "| (?: dir|lang";
  if (!sharedNames.patterns?.[1]?.begin?.includes(sharedFunctions))
    throw new Error("CSS shared-name pseudo functions changed");
  sharedNames.patterns[1]!.begin = sharedNames.patterns[1]!.begin!.replace(
    sharedFunctions,
    "| (?: active-view-transition-type|dir|global|host|host-context|lang|local|state",
  );
}

/** CSS interpolation pass: Resume identifier and numeric-suffix scopes around template holes. */
function patchCssInterpolationFragments(grammar: TmRule): void {
  const repository = grammar.repository!;
  const identifierEscape = "\\\\(?:[0-9a-fA-F]{1,6}|(?![`$\\\\]).)";
  const identifierStart = `(?:[a-zA-Z_]|[^\\x00-\\x7F]|${identifierEscape}|-(?:[a-zA-Z_]|[^\\x00-\\x7F]|${identifierEscape}|-))`;
  const identifierContinue = `(?:[-a-zA-Z_0-9]|[^\\x00-\\x7F]|${identifierEscape})`;
  const identifier = `${identifierStart}${identifierContinue}*`;

  const identifierBridge = (
    prefix: string,
    scope: string,
    punctuation = false,
    allowEmptyIdentifier = false,
  ): TmRule => ({
    begin: punctuation
      ? `(${prefix})(${allowEmptyIdentifier ? `(?:${identifier})?` : identifier})(?=\\$\\{)`
      : `(${prefix}${allowEmptyIdentifier ? `(?:${identifier})?` : identifier})(?=\\$\\{)`,
    beginCaptures: punctuation
      ? {
          "1": { name: `${scope} punctuation.definition.entity.css` },
          "2": { name: scope, patterns: [{ include: "#escapes" }] },
        }
      : {
          "1": { name: scope, patterns: [{ include: "#escapes" }] },
        },
    end: `${identifierContinue}*(?!${identifierContinue}|\\$\\{)`,
    endCaptures: {
      "0": { name: scope, patterns: [{ include: "#escapes" }] },
    },
    patterns: [
      {
        captures: {
          "1": { name: scope, patterns: [{ include: "#escapes" }] },
        },
        match: `(${identifierContinue}+)(?=\\$\\{)`,
      },
    ],
  });

  const selector = repository["selector"]!;
  const selectorHoleBoundary = "|(?:\\.|#)(?:";
  if (!selector.begin?.includes(selectorHoleBoundary))
    throw new Error("patched CSS selector identifier boundary changed");
  selector.begin = selector.begin.replace(selectorHoleBoundary, "|[.#](?=\\$\\{)|(?:\\.|#)(?:");

  const selectorPatterns = repository["selector-innards"]!.patterns!;
  selectorPatterns.unshift(
    identifierBridge("\\.", "entity.other.attribute-name.class.css", true, true),
    identifierBridge("\\#", "entity.other.attribute-name.id.css", true, true),
    identifierBridge("::", "entity.other.attribute-name.pseudo-element.css", true, true),
    identifierBridge(":", "entity.other.attribute-name.pseudo-class.css", true, true),
    identifierBridge("", "entity.name.tag.css"),
  );

  const viewTransitionElements = selectorPatterns.find(
    (rule) => rule.name === "meta.function.pseudo-element.view-transition.css",
  );
  const viewTransitionTypes = selectorPatterns.find(
    (rule) => rule.name === "meta.function.pseudo-class.view-transition.css",
  );
  if (!viewTransitionElements?.patterns || !viewTransitionTypes?.patterns)
    throw new Error("CSS view-transition function rules changed");
  viewTransitionElements.patterns.unshift(
    identifierBridge("\\.", "variable.parameter.view-transition-class.css", true, true),
    identifierBridge("", "variable.parameter.view-transition-name.css", false, true),
  );
  viewTransitionTypes.patterns.unshift(
    identifierBridge("", "variable.parameter.view-transition-type.css", false, true),
  );

  const propertyPatterns = repository["rule-list-innards"]!.patterns!;
  const customProperty = propertyPatterns.findIndex((rule) => rule.name === "variable.css");
  if (customProperty === -1) throw new Error("CSS custom-property rule changed");
  propertyPatterns.splice(
    customProperty,
    0,
    identifierBridge("--", "variable.css", false, true),
    identifierBridge("", "meta.property-name.css"),
  );

  const variableFunction = repository["functions"]!.patterns!.find(
    (rule) => rule.name === "meta.function.variable.css",
  );
  const variableArgument = variableFunction?.patterns?.findIndex(
    (rule) => rule.name === "variable.argument.css",
  );
  if (variableArgument === undefined || variableArgument === -1)
    throw new Error("CSS variable-argument rule changed");
  variableFunction!.patterns!.splice(
    variableArgument,
    0,
    identifierBridge("--", "variable.argument.css", false, true),
  );

  const numericPatterns = repository["numeric-values"]!.patterns!;
  const numeric = numericPatterns.find((rule) => rule.name === "constant.numeric.css");
  const units = numeric?.match?.match(/\(%\)\|\(([-A-Za-z|]+)\)\\b/)?.[1];
  if (!units) throw new Error("CSS numeric unit rule changed");
  numericPatterns.unshift({
    captures: {
      "1": { name: "keyword.other.unit.percentage.css" },
      "2": { name: "keyword.other.unit.${2:/downcase}.css" },
    },
    match: `(?i)(?<=\\})(?:(%)|(${units})\\b)`,
  });
}

type Host = {
  language: string;
  scope: string;
  suffix: string;
  expressionScope?: string;
  substitution?: string;
};
const hosts: Host[] = [
  { language: "javascript", scope: "source.js", suffix: "js" },
  { language: "javascriptreact", scope: "source.js.jsx", suffix: "js.jsx" },
  { language: "typescript", scope: "source.ts", suffix: "ts" },
  { language: "typescriptreact", scope: "source.tsx", suffix: "tsx" },
  { language: "tsrx", scope: "source.tsrx", suffix: "js" },
  { language: "mdx", scope: "source.mdx", suffix: "tsx", expressionScope: "source.tsx" },
  {
    language: "angular",
    scope: "expression.ng",
    suffix: "ts",
    substitution: "templateLiteralSubstitutionElement",
  },
];

/** Wrapper phase: Recognize a css tag and enter the appropriate transformed CSS context. */
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
      : "meta.embedded.inline.csslit meta.property-list.css",
    patterns: global
      ? [{ include: "source.csslit.css" }]
      : [
          { include: "source.csslit.css#at-rules" },
          { include: "source.csslit.css#rule-list-innards" },
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

/** Hole phase: Suspend CSS and restore the host grammar for interpolated expressions. */
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
      patterns: [
        {
          include: `${host.expressionScope ?? host.scope}#${host.substitution ?? "template-substitution-element"}`,
        },
      ],
    },
  ],
});

const syntaxesDir = join(import.meta.dirname, "..", "generated", "syntaxes");
const require = createRequire(import.meta.url);
const cson = require("cson-parser") as { parse(source: string): object };
const CSS_GRAMMAR_COMMIT = "e763075e78c4cfecc0bb5270e920c78776014f96";
const GENERATED_NOTE = `Generated by grammar/build-grammars.mts from microsoft/vscode-css#47@${CSS_GRAMMAR_COMMIT} — run \`vp run grammars\` after editing the generator; do not edit this file.`;

const scopeRenames: Record<string, string> = {
  "source.css": "source.csslit.css",
};

const outputs = new Map<string, object>();

const cssGrammar = cson.parse(
  readFileSync(require.resolve("vscode-css/grammars/css.cson"), "utf8"),
) as TmRule;
patchCssGrammar(cssGrammar);
patchGrammar(cssGrammar, scopeRenames);
patchCssInterpolationFragments(cssGrammar);
outputs.set("csslit-css.tmLanguage.json", {
  information_for_contributors: GENERATED_NOTE,
  ...cssGrammar,
  scopeName: scopeRenames["source.css"],
});

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

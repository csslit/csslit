# Architecture

## Syntax highlighting

The extension cannot embed VS Code's CSS grammar directly. An unterminated CSS token can
otherwise consume the closing backtick and corrupt highlighting after the template.
`grammar/build-grammars.mts` patches the CSS TextMate grammar from microsoft/vscode-css#47 so no rule
can consume an unescaped backtick or `${`, and every active rule can bail out at either
boundary. Unsupported regex or grammar constructs fail the build rather than weakening
that guarantee silently.

The grammar is pinned to a commit until its native CSS nesting support reaches VS Code.
A CSS-specific pass adds embedded selector boundaries, current and CSS Modules pseudos,
and forward-compatible pseudo fallbacks. A separate grammar-agnostic pass then provides
the template boundary guarantees. A final CSS/template-specific pass lets identifier
scopes resume across interpolations and derives unit suffix scopes from the transformed
numeric rule.

Separate injection grammars restore the host JavaScript, TypeScript, TSRX, or Angular expression
grammar inside interpolations. HTML, Astro, Marko, MDX, Svelte, and Vue reuse the JavaScript and TypeScript
injections in their embedded script and template-expression scopes. The injections also consume
JavaScript escape pairs so boundary detection follows template-literal backslash parity.

## Language features

Template discovery is selected by TypeScript implementation. When TypeScript Native Preview is
enabled, JavaScript and TypeScript reuse its running TypeScript 7 API session. Otherwise, the
`@csslit/typescript-plugin` server plugin is used. Each integration produces templates whose quasis
contain source spans plus cooked text. The shared virtual-CSS builder alone handles interpolation
holes, escapes, and source mapping.

The server plugin walks the language service's `SourceFile` and returns quasi spans as edits from a
private refactor; the extension decodes those edits into the template contract without parsing the
source. The extension contributes the plugin globally for plain JavaScript and TypeScript. For
framework files, the framework's own TypeScript plugin (such as TSRX) wraps the language service in
a proxy that lowers the source and maps positions, so `@csslit/typescript-plugin` must run _inside_
that proxy: the user installs it as a project plugin in `tsconfig.json`, listed before the framework
plugin so it loads closest to the language service and the framework proxy maps its returned edits
back to the source document. There is deliberately no parsing fallback: without the plugin there is
no template result. Framework files therefore require the classic TypeScript server; TypeScript
Native Preview does not load tsserver plugins.

`css` bodies are wrapped in a rule while `css.global` bodies remain stylesheets. Holes are
replaced with small context-dependent placeholders. A sparse mapping records only text
copied verbatim from the source; edits that touch synthetic text, cooked escapes, or cross
a hole are rejected. Each source version and template receives an immutable virtual URI,
and its content is retained only while requests using that URI are active.

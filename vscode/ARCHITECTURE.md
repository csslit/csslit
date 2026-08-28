# Architecture

## Syntax highlighting

The extension cannot embed VS Code's CSS grammar directly. An unterminated CSS token can
otherwise consume the closing backtick and corrupt highlighting after the template.
`grammar/build-grammars.ts` patches the CSS TextMate grammar from microsoft/vscode-css#47 so no rule
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
grammar inside interpolations. HTML, Astro, Marko, MDX, Svelte, and Vue reuse the JavaScript and
TypeScript injections in their embedded script and template-expression scopes. The injections also
consume JavaScript escape pairs so boundary detection follows template-literal backslash parity.

## Language features

Template discovery is selected by TypeScript implementation. When TypeScript Native Preview is
enabled, JavaScript and TypeScript reuse its running TypeScript 7 API session. Otherwise, the
`@csslit/typescript-plugin` server plugin is used. Each integration produces templates whose quasis
contain source spans plus cooked text. The shared virtual-CSS builder alone handles interpolation
holes, escapes, and source mapping.

The server plugin walks the language service's `SourceFile` and returns quasi spans as edits from a
private refactor. The extension requests that refactor through a private tsserver protocol command
which delegates to tsserver's normal refactor handlers, preserving language-integration position
mapping without going through VS Code's cancel-on-provider-registration code-action aggregation. It
decodes those edits into the template contract without parsing the source. There is deliberately no
parsing fallback: without the plugin there is no template result. Languages that need a mapping
plugin therefore require the classic TypeScript server; TypeScript Native Preview does not load
tsserver plugins. Files using `.js`, `.jsx`, `.ts`, and `.tsx` use the direct path, so frameworks
including React, Solid, Vue JSX, and Angular need no framework-specific csslit integration.

Other supported languages use `.tsrx`, `.vue`, and `.mdx` files. They need
`@csslit/typescript-plugin` listed as a project plugin in `tsconfig.json`. That entry puts csslit
inside the language's own language-service proxy, which lowers the source and maps positions, so it
can map csslit's returned edits back to the source document. The extension's own
`typescriptServerPlugins` contribution cannot take that position: its load order relative to a
project plugin is not controllable.

Where the language's documented setup also lists a project plugin, as `.tsrx` does, csslit must
come **before** it. This makes csslit load closest to the language service so the mapping proxy wraps
it. The `.vue` and `.mdx` integrations arrange their own tsserver integration through their
extensions; duplicating those plugins in `tsconfig.json` would change the topology described here.

The `languages` array on the extension's `typescriptServerPlugins` contribution is separate from
loading the plugin: it is what makes VS Code's built-in TypeScript extension manage documents of
those languages, and declare their extensions to tsserver. That list is a union across every
installed extension's contribution. CSSlit declares both the historical `ripple` ID and the current
`tsrx` ID because TSRX's own VS Code integration registers that language by patching the built-in
TypeScript extension at runtime, which can fail when VS Code's bundled extension changes.

`css` bodies are wrapped in a rule while `css.global` bodies remain stylesheets. Holes are
replaced with small context-dependent placeholders. A sparse mapping records only text
copied verbatim from the source; edits that touch synthetic text, cooked escapes, or cross
a hole are rejected. Each source version and template receives an immutable virtual URI,
and its content is retained only while requests using that URI are active.

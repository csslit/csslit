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

Separate injection grammars restore the host JavaScript or TypeScript grammar inside
interpolations. They also consume JavaScript escape pairs so boundary detection follows
template-literal backslash parity.

## Language features

The extension connects to TypeScript 7 through its native API session using a bundled API
client. It uses the parser's AST to locate `css` and `css.global` templates, including
during error recovery, and the parser's cooked template text to build a compact virtual
CSS document for the template under the cursor.

`css` bodies are wrapped in a rule while `css.global` bodies remain stylesheets. Holes are
replaced with small context-dependent placeholders. A sparse mapping records only text
copied verbatim from the source; edits that touch synthetic text, cooked escapes, or cross
a hole are rejected. Each source version and template receives an immutable virtual URI,
and its content is retained only while requests using that URI are active.

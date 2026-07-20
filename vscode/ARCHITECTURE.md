# Architecture

## Syntax highlighting

The extension cannot embed VS Code's CSS grammar directly. An unterminated CSS token can
otherwise consume the closing backtick and corrupt highlighting after the template.
`grammar/build-grammars.mts` patches the upstream CSS and SCSS TextMate grammars so no rule
can consume an unescaped backtick or `${`, and every active rule can bail out at either
boundary. Unsupported regex or grammar constructs fail the build rather than weakening
that guarantee silently.

The SCSS grammar is used for colorization because it handles CSS nesting better than VS
Code's CSS TextMate grammar. Embedded language metadata still identifies the content as
CSS, and language features use VS Code's CSS language service.

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

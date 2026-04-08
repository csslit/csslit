use crate::{CompileTimeTransformOptions, OxcTransformResult, quote_expr, quote_stmt};
use oxc_allocator::{Allocator, CloneIn, Vec};
use oxc_ast::{
  AstBuilder, NONE,
  ast::{Expression, Statement, TemplateLiteral},
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_sourcemap::{SourceMapBuilder, Token};
use oxc_span::{SPAN, SourceType};
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};
use rolldown_sourcemap::{SourceMap, collapse_sourcemaps};
use std::{collections::HashMap, path::Path};

use super::shared::CssImportSymbols;

struct ResolvedLocation {
  source_id: u32,
  line: u32,
  column: u32,
}

struct SourceLocationContext<'a> {
  builder: SourceMapBuilder,
  source_rope: Rope,
  lookup_table: Option<std::vec::Vec<&'a [Token]>>,
  source_text: &'a str,
  filename: &'a str,
  input_map: Option<&'a SourceMap>,
  root: String,
  normalized_sources: HashMap<String, u32>,
  normalized_source_contents: HashMap<String, Option<String>>,
}

impl<'a> SourceLocationContext<'a> {
  fn new(
    source_text: &'a str,
    filename: &'a str,
    root: &str,
    input_map: Option<&'a SourceMap>,
  ) -> Self {
    let mut builder = SourceMapBuilder::default();
    builder.set_file(&format!("{filename}.csslit.module.css"));

    let mut normalized_source_contents = HashMap::new();
    if let Some(map) = input_map {
      for (source_id, source) in map.get_sources().enumerate() {
        normalized_source_contents
          .entry(normalize_source_id(source.as_ref(), root))
          .or_insert_with(|| {
            map.get_source_content(source_id as u32)
              .map(|content| content.as_ref().to_owned())
          });
      }
    }
    normalized_source_contents
      .entry(normalize_source_id(filename, root))
      .or_insert_with(|| Some(source_text.to_owned()));

    Self {
      builder,
      source_rope: Rope::from_str(source_text),
      lookup_table: input_map.map(SourceMap::generate_lookup_table),
      source_text,
      filename,
      input_map,
      root: root.to_owned(),
      normalized_sources: HashMap::new(),
      normalized_source_contents,
    }
  }

  fn resolve(&mut self, span: oxc_span::Span) -> ResolvedLocation {
    let (line, column) = get_line_column(&self.source_rope, span.start, self.source_text);

    if let Some(map) = self.input_map
      && let Some(table) = self.lookup_table.as_deref()
      && let Some(token) = map.lookup_token(table, line, column)
      && let Some(source_id) = token.get_source_id()
      && let Some(source) = map.get_source(source_id)
    {
      return ResolvedLocation {
        source_id: self.ensure_source_id(source.as_ref()),
        line: token.get_src_line(),
        column: token.get_src_col(),
      };
    }

    ResolvedLocation {
      source_id: self.ensure_source_id(self.filename),
      line,
      column,
    }
  }

  fn add_token(&mut self, dst_line: u32, dst_col: u32, source: ResolvedLocation) {
    self.builder.add_token(
      dst_line,
      dst_col,
      source.line,
      source.column,
      Some(source.source_id),
      None,
    );
  }

  fn into_json_string(self) -> String {
    let mut map = self.builder.into_sourcemap();
    let source_contents = map
      .get_sources()
      .map(|source| {
        self
          .normalized_source_contents
          .get(source.as_ref())
          .and_then(|content| content.as_deref())
      })
      .collect::<std::vec::Vec<_>>();
    map.set_source_contents(source_contents);
    map.to_json_string()
  }

  fn ensure_source_id(&mut self, source: &str) -> u32 {
    let normalized = normalize_source_id(source, &self.root);
    if let Some(source_id) = self.normalized_sources.get(&normalized) {
      return *source_id;
    }

    let source_id = if let Some(content) = self
      .normalized_source_contents
      .get(&normalized)
      .and_then(|content| content.as_deref())
    {
      self.builder.add_source_and_content(&normalized, content)
    } else {
      self.builder.set_source_and_content(&normalized, "")
    };

    self.normalized_sources.insert(normalized, source_id);
    source_id
  }
}

fn normalize_source_id(source: &str, root: &str) -> String {
  let (path, query) = source
    .split_once('?')
    .map_or((source, None), |(path, query)| (path, Some(query)));
  let normalized_path = path.replace('\\', "/");

  let normalized = if Path::new(path).is_absolute() {
    match Path::new(path).strip_prefix(root) {
      Ok(relative) => format!("/{}", relative.to_string_lossy().replace('\\', "/")),
      Err(_) => normalized_path,
    }
  } else {
    normalized_path
  };

  match query {
    Some(query) => format!("{normalized}?{query}"),
    None => normalized,
  }
}

struct CompileTimeVisitor<'a> {
  blocks: Vec<'a, TemplateLiteral<'a>>,
  css_import_symbols: CssImportSymbols<'a>,
}

impl<'a> Traverse<'a, ()> for CompileTimeVisitor<'a> {
  fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
    if let Expression::TaggedTemplateExpression(tagged) = expr
      && self.css_import_symbols.is_css(&tagged.tag, ctx)
    {
      self.blocks.push(tagged.quasi.clone_in(ctx.ast.allocator));
      *expr = quote_expr!(ctx.ast, "");
    }
  }
}

pub(super) fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformOptions,
) -> OxcTransformResult {
  let source_type = SourceType::from_path(&options.filename)
    .unwrap_or_default()
    .with_typescript(true)
    .with_jsx(true);

  let allocator = &Allocator::default();

  let mut ret = Parser::new(allocator, &source_text, source_type).parse();
  let semantic = SemanticBuilder::new().build(&ret.program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &ret.program);
  let scoping = semantic.into_scoping();

  let mut visitor = CompileTimeVisitor {
    blocks: Vec::new_in(allocator),
    css_import_symbols,
  };

  traverse_mut(&mut visitor, allocator, &mut ret.program, scoping, ());

  let location_context = options.sourcemap.then(|| {
    SourceLocationContext::new(
      &source_text,
      &options.filename,
      &options.root,
      options.input_map.as_ref(),
    )
  });

  let ast = AstBuilder::new(allocator);

  let original_body = ret.program.body;
  let (blocks, baseline_map_json) =
    build_css_eval_blocks(ast, allocator, visitor.blocks, location_context);

  ret.program.body = ast.vec_with_capacity(
    2
      + original_body
        .iter()
        .filter(|statement| matches!(statement, Statement::ImportDeclaration(_)))
        .count(),
  );

  ret.program.body.push(quote_stmt!(
    ast,
    import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
  ));

  ret.program.body.extend(
    original_body
      .into_iter()
      .filter(|statement| matches!(statement, Statement::ImportDeclaration(_))),
  );

  let baseline_map = match baseline_map_json.as_deref() {
    Some(json) => quote_expr!(ast, JSON.parse(@{json})),
    None => quote_expr!(ast, null),
  };

  ret.program.body.push(quote_stmt!(
    ast,
    export const __csslit_eval_result = (__csslit_eval_runtime.finalizeCsslitEvalResult({
      blocks: @{blocks},
      map: @{baseline_map},
    }));
  ));

  let result = Codegen::new()
    .with_options(CodegenOptions {
      source_map_path: options
        .sourcemap
        .then(|| options.filename.to_string().into()),
      ..CodegenOptions::default()
    })
    .with_source_text(&source_text)
    .build(&ret.program);

  OxcTransformResult {
    code: result.code,
    map: result.map.map(|transform_map| match options.input_map.as_ref() {
      Some(input_map) => collapse_sourcemaps(&[input_map, &transform_map]),
      None => transform_map,
    }),
  }
}

fn build_css_eval_blocks<'a>(
  ast: AstBuilder<'a>,
  allocator: &'a Allocator,
  templates: Vec<'a, TemplateLiteral<'a>>,
  location_context: Option<SourceLocationContext<'a>>,
) -> (Vec<'a, Expression<'a>>, Option<String>) {
  let mut blocks = Vec::with_capacity_in(templates.len(), allocator);

  let Some(mut location_context) = location_context else {
    for template in templates {
      blocks.push(build_css_eval_block_expression(
        ast,
        template,
        Vec::new_in(allocator),
      ));
    }

    return (blocks, None);
  };

  let mut current_line = 0u32;

  for template in templates {
    let mut patch_lines = Vec::with_capacity_in(template.expressions.len(), allocator);

    let start_loc = location_context.resolve(template.quasis.first().unwrap().span);
    location_context.add_token(current_line, 0, start_loc);

    current_line += 1;

    for (index, quasi) in template.quasis.iter().enumerate() {
      let cooked = quasi
        .value
        .cooked
        .as_deref()
        .unwrap_or(quasi.value.raw.as_str());
      let raw = quasi.value.raw.as_str();
      let generated_line_count = cooked.chars().filter(|ch| *ch == '\n').count() as u32 + 1;
      let source_line_count = raw.chars().filter(|ch| *ch == '\n').count() as u32 + 1;

      if !cooked.is_empty() {
        let quasi_loc = location_context.resolve(quasi.span);
        for line_offset in 0..generated_line_count {
          location_context.add_token(
            current_line + line_offset,
            0,
            ResolvedLocation {
              source_id: quasi_loc.source_id,
              line: quasi_loc.line + line_offset.min(source_line_count - 1),
              column: if line_offset == 0 { quasi_loc.column } else { 0 },
            },
          );
        }

        current_line += generated_line_count - 1;
      }

      if index < template.expressions.len() {
        patch_lines.push(current_line);
      }
    }

    current_line += 2;
    blocks.push(build_css_eval_block_expression(ast, template, patch_lines));
  }

  (blocks, Some(location_context.into_json_string()))
}

fn build_css_eval_block_expression<'a>(
  ast: AstBuilder<'a>,
  template: TemplateLiteral<'a>,
  patch_lines: Vec<'a, u32>,
) -> Expression<'a> {
  let patch_lines =
    ast.vec_from_iter(patch_lines.into_iter().map(|line| quote_expr!(ast, @{line})));

  ast.expression_tagged_template(
    SPAN,
    quote_expr!(ast, __csslit_eval_runtime.createCsslitCapture({ patch_lines: @{patch_lines} })),
    NONE,
    template,
  )
}

#[cfg(test)]
mod tests {
  use super::transform_compile_time;
  use super::normalize_source_id;
  use crate::{CompileTimeTransformOptions, RawSourceMap};
  use rolldown_sourcemap::SourceMap;

  #[test]
  fn compile_time_transform_uses_virtual_eval_runtime() {
    let result = transform_compile_time(
      r#"
        import { css } from "csslit";
        import { theme } from "./theme";

        const styles = css`
          color: ${theme.primary};
        `;
      "#
      .to_string(),
      CompileTimeTransformOptions {
        root: "C:/repo".to_string(),
        filename: "C:/repo/src/App.tsx".to_string(),
        sourcemap: false,
        input_map: None,
      },
    );

    assert!(
      result
        .code
        .contains(r#"import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";"#)
    );
    assert!(
      result
        .code
        .contains("__csslit_eval_runtime.createCsslitCapture(")
    );
    assert!(
      result
        .code
        .contains("__csslit_eval_runtime.finalizeCsslitEvalResult(")
    );
    assert!(!result.code.contains("source_contents"));
  }

  #[test]
  fn compile_time_transform_bakes_baseline_map_and_normalized_sources() {
    let input_map = SourceMap::try_from(RawSourceMap {
      version: 3,
      file: Some("App.tsx".to_string()),
      mappings: "AAAA".to_string(),
      names: vec![],
      source_root: None,
      sources: vec!["C:/repo/src/theme.ts?used".to_string()],
      sources_content: Some(vec![Some(
        "export const theme = { primary: \"red\" };".to_string(),
      )]),
      x_google_ignore_list: None,
      debug_id: None,
    })
    .unwrap();

    let result = transform_compile_time(
      r#"
        import { css } from "csslit";

        const styles = css`
          color: ${"red"};
        `;
      "#
      .to_string(),
      CompileTimeTransformOptions {
        root: "C:/repo".to_string(),
        filename: "C:/repo/src/App.tsx".to_string(),
        sourcemap: true,
        input_map: Some(input_map),
      },
    );

    assert!(result.code.contains(r#"JSON.parse("#));
    assert!(result.code.contains("patch_lines: ["));
  }

  #[test]
  fn normalize_source_id_preserves_query_when_relativizing_to_root() {
    assert_eq!(
      normalize_source_id("C:/repo/src/theme.ts?used", "C:/repo"),
      "/src/theme.ts?used"
    );
  }
}
